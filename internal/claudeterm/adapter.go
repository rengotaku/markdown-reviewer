// Package claudeterm adapts Claude Code metadata to the shared agent contract.
// Only session JSON metadata is read; keys and internal sockets are not used.
package claudeterm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"markdown-reviewer/internal/agent"
	"markdown-reviewer/internal/terminal"
)

type metadata struct {
	SessionID string `json:"sessionId"`
	Cwd       string `json:"cwd"`
	Status    string `json:"status"`
	Name      string `json:"name"`
	ProcStart string `json:"procStart"`
	Kind      string `json:"kind"`
	PID       int    `json:"pid"`
}

type Adapter struct {
	writer terminal.Writer
	// process reports the session's terminal and whether its process is
	// alive. A non-nil error means liveness could not be determined (the
	// check failed or was cut short), which is never taken as "dead".
	process func(context.Context, metadata) (string, bool, error)
	// liveness remembers whether a process incarnation (PID + start time) is
	// alive, so the editor's status polling (#399) does not start one `ps`
	// per session on every poll. Under load those runs used to overrun the
	// status request's deadline, and sessions not yet checked were dropped as
	// dead, so the editor showed "no session" for a live one. An incarnation
	// that is dead stays dead. One that is alive is checked again once
	// aliveFor has passed, and by every Send, so a session that exited —
	// even while busy, when no send reaches it — drops out. Guarded by mu.
	liveness map[incarnation]verdict
	now      func() time.Time
	dir      string
	mu       sync.Mutex
}

// aliveFor is how long an "alive" verdict is trusted before the process is
// checked again: the longest an exited session can still look present.
const aliveFor = 30 * time.Second

type verdict struct {
	checked time.Time
	alive   bool
}

type incarnation struct {
	start string
	pid   int
}

func incarnationOf(s metadata) incarnation { return incarnation{pid: s.PID, start: s.ProcStart} }

func New(writer terminal.Writer) *Adapter {
	dir := os.Getenv("CLAUDE_CONFIG_DIR")
	if dir == "" {
		home, _ := os.UserHomeDir()
		dir = filepath.Join(home, ".claude")
	}
	return &Adapter{dir: filepath.Join(dir, "sessions"), process: processTTY, writer: writer, liveness: map[incarnation]verdict{}, now: time.Now}
}

var _ agent.Summarizer = (*Adapter)(nil)

func (*Adapter) ID() string { return "claude" }

func (a *Adapter) metadata() ([]metadata, error) {
	entries, err := os.ReadDir(a.dir)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var out []metadata
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		pid, err := strconv.Atoi(strings.TrimSuffix(entry.Name(), ".json"))
		if err != nil || pid <= 0 {
			continue
		}
		f, err := os.Open(filepath.Join(a.dir, entry.Name()))
		if err != nil {
			continue
		}
		var s metadata
		err = json.NewDecoder(io.LimitReader(f, 64<<10)).Decode(&s)
		_ = f.Close()
		if err != nil || s.PID != pid || s.SessionID == "" || !filepath.IsAbs(s.Cwd) || s.ProcStart == "" || s.Kind != "interactive" {
			continue
		}
		out = append(out, s)
	}
	return out, nil
}

func (a *Adapter) Sessions(ctx context.Context) ([]agent.Session, error) {
	entries, err := a.metadata()
	if err != nil {
		return nil, err
	}
	var sessions []agent.Session
	seen := make(map[incarnation]struct{}, len(entries))
	for _, s := range entries {
		key := incarnationOf(s)
		seen[key] = struct{}{}
		if !a.alive(ctx, s, key) {
			continue
		}
		sessions = append(sessions, agent.Session{ID: s.SessionID, Cwd: s.Cwd, Name: s.Name, Instance: s.ProcStart, PID: s.PID, Ready: readyForInput(s.Status), Background: s.Status == "shell"})
	}
	a.forgetExcept(seen)
	return sessions, nil
}

// alive answers from the remembered liveness, running `ps` only for an
// incarnation seen for the first time or whose "alive" has expired. A check
// that could not decide (cut short by ctx, ps failing to run) is not
// remembered: a new incarnation counts as absent until a later check
// decides, and an expired one keeps its last "alive" rather than turning
// into "no session".
func (a *Adapter) alive(ctx context.Context, s metadata, key incarnation) bool {
	a.mu.Lock()
	v, known := a.liveness[key]
	a.mu.Unlock()
	if known && (!v.alive || a.now().Sub(v.checked) < aliveFor) {
		return v.alive
	}
	_, alive, err := a.process(ctx, s)
	if err != nil {
		return known && v.alive
	}
	return a.remember(key, alive)
}

// remember records a verdict and returns the one now on record. An
// incarnation found dead stays dead: a check that started earlier and saw it
// alive must not bring it back once Send has found it gone.
func (a *Adapter) remember(key incarnation, alive bool) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if v, ok := a.liveness[key]; ok && !v.alive {
		return false
	}
	a.liveness[key] = verdict{alive: alive, checked: a.now()}
	return alive
}

// forgetExcept drops incarnations whose metadata file is gone, so the map
// does not grow with every session that ever ran.
func (a *Adapter) forgetExcept(seen map[incarnation]struct{}) {
	a.mu.Lock()
	for key := range a.liveness {
		if _, ok := seen[key]; !ok {
			delete(a.liveness, key)
		}
	}
	a.mu.Unlock()
}

func (a *Adapter) Send(ctx context.Context, target agent.Session, text string) error {
	verified := agent.TimeStep(ctx, "verify")
	entries, err := a.metadata()
	if err != nil {
		verified()
		return err
	}
	for _, s := range entries {
		if s.SessionID != target.ID || s.PID != target.PID || s.ProcStart != target.Instance {
			continue
		}
		// Always a fresh check: this is where a remembered "alive" turns out
		// to be stale, and a session that has exited is forgotten here.
		tty, alive, err := a.process(ctx, s)
		verified()
		if err != nil {
			return err
		}
		if !a.remember(incarnationOf(s), alive) {
			return agent.ErrNoSession
		}
		if !readyForInput(s.Status) {
			return agent.ErrBusy
		}
		if tty == "" {
			return agent.ErrNoTerminal
		}
		written := agent.TimeStep(ctx, "write")
		defer written()
		return a.writer.WriteText(ctx, tty, text)
	}
	verified()
	return agent.ErrNoSession
}

// OpenerIdentity is the Claude-specific environment detection used by mr open.
func OpenerIdentity() (agent.Identity, bool) {
	pid, err := strconv.Atoi(os.Getenv("CLAUDE_PID"))
	id := os.Getenv("CLAUDE_CODE_SESSION_ID")
	if err != nil || pid <= 0 || id == "" {
		return agent.Identity{}, false
	}
	return agent.Identity{AgentID: "claude", SessionID: id, PID: pid}, true
}

var ttyPattern = regexp.MustCompile(`^ttys[0-9]+$`)

// shell means the foreground turn ended while a background local_bash task
// remains alive; it does not mean the user is typing a shell command.
// Observed session metadata: https://github.com/herdrdev/herdr/issues/3414
func readyForInput(status string) bool {
	return status == "idle" || status == "shell"
}

func processTTY(ctx context.Context, s metadata) (string, bool, error) {
	if runtime.GOOS != "darwin" {
		return "", false, nil
	}
	cmd := exec.CommandContext(ctx, "/bin/ps", "-o", "tty=,lstart=,comm=", "-p", strconv.Itoa(s.PID))
	// Claude's procStart is UTC, while ps otherwise formats in the local zone.
	cmd.Env = append(os.Environ(), "TZ=UTC", "LC_ALL=C")
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	raw, err := cmd.Output()
	if err != nil {
		// ps exits 1 with no output at all when the PID does not exist; that
		// is the only failure that proves the process is gone. Anything else
		// (killed by ctx, failed to start, an error message) is inconclusive.
		var exit *exec.ExitError
		if errors.As(err, &exit) && exit.ExitCode() == 1 && len(bytes.TrimSpace(raw)) == 0 && stderr.Len() == 0 {
			return "", false, nil
		}
		return "", false, err
	}
	fields := strings.Fields(string(raw))
	if len(fields) < 7 || strings.Join(fields[1:6], " ") != strings.Join(strings.Fields(s.ProcStart), " ") {
		return "", false, nil
	}
	if !strings.Contains(strings.ToLower(filepath.Base(fields[6])), "claude") {
		return "", false, nil
	}
	if !ttyPattern.MatchString(fields[0]) {
		return "", true, nil
	}
	return "/dev/" + fields[0], true, nil
}

// transcriptLine is the part of a conversation-log line needed to find the
// final reply of a turn.
type transcriptLine struct {
	Timestamp string `json:"timestamp"`
	Type      string `json:"type"`
	Message   struct {
		StopReason string          `json:"stop_reason"`
		Content    json.RawMessage `json:"content"`
	} `json:"message"`
	IsSidechain bool `json:"isSidechain"`
}

// Summary returns the text of the first final reply (assistant, end_turn, not
// a subagent) logged after since: the turn that answered the send. A send is
// only delivered to an idle session, so no earlier turn ends after since, while
// later ones belong to other work (another file's send, or the reader typing
// in the terminal) and must not be stored as this file's summary. The log path is found by globbing for the
// session id rather than by reconstructing the project directory name.
func (a *Adapter) Summary(_ context.Context, session agent.Session, since time.Time) (string, time.Time, bool, error) {
	if session.ID == "" || strings.ContainsAny(session.ID, `/\*?[`) {
		return "", time.Time{}, false, nil
	}
	pattern := filepath.Join(filepath.Dir(a.dir), "projects", "*", session.ID+".jsonl")
	matches, err := filepath.Glob(pattern)
	if err != nil || len(matches) == 0 {
		return "", time.Time{}, false, nil
	}
	var (
		bestText string
		bestAt   time.Time
		found    bool
	)
	for _, name := range matches {
		text, at, ok, err := firstFinalReply(name, since)
		if err != nil {
			return "", time.Time{}, false, err
		}
		if ok && (!found || at.Before(bestAt)) {
			bestText, bestAt, found = text, at, true
		}
	}
	return bestText, bestAt, found, nil
}

func firstFinalReply(name string, since time.Time) (string, time.Time, bool, error) {
	f, err := os.Open(name)
	if err != nil {
		if os.IsNotExist(err) {
			return "", time.Time{}, false, nil
		}
		return "", time.Time{}, false, err
	}
	defer func() { _ = f.Close() }()
	// bufio.Reader (not Scanner): one line can be several MB, so read whole
	// lines with no fixed token cap.
	r := bufio.NewReader(f)
	for {
		raw, readErr := r.ReadBytes('\n')
		if len(bytes.TrimSpace(raw)) > 0 {
			if t, ts, ok := parseFinalReply(raw); ok && ts.After(since) {
				return t, ts, true, nil
			}
		}
		if readErr == io.EOF {
			return "", time.Time{}, false, nil
		}
		if readErr != nil {
			return "", time.Time{}, false, readErr
		}
	}
}

func parseFinalReply(raw []byte) (string, time.Time, bool) {
	var line transcriptLine
	if json.Unmarshal(raw, &line) != nil || line.Type != "assistant" || line.IsSidechain || line.Message.StopReason != "end_turn" {
		return "", time.Time{}, false
	}
	ts, err := time.Parse(time.RFC3339Nano, line.Timestamp)
	if err != nil {
		return "", time.Time{}, false
	}
	var blocks []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if json.Unmarshal(line.Message.Content, &blocks) != nil {
		return "", time.Time{}, false
	}
	var parts []string
	for _, b := range blocks {
		if b.Type == "text" && b.Text != "" {
			parts = append(parts, b.Text)
		}
	}
	if len(parts) == 0 {
		return "", time.Time{}, false
	}
	return strings.Join(parts, "\n\n"), ts, true
}
