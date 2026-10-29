// Package claudeterm adapts Claude Code metadata to the shared agent contract.
// Only session JSON metadata is read; keys and internal sockets are not used.
package claudeterm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
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
	writer  terminal.Writer
	process func(context.Context, metadata) (string, bool)
	dir     string
}

func New(writer terminal.Writer) *Adapter {
	dir := os.Getenv("CLAUDE_CONFIG_DIR")
	if dir == "" {
		home, _ := os.UserHomeDir()
		dir = filepath.Join(home, ".claude")
	}
	return &Adapter{dir: filepath.Join(dir, "sessions"), process: processTTY, writer: writer}
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
	for _, s := range entries {
		if _, alive := a.process(ctx, s); !alive {
			continue
		}
		sessions = append(sessions, agent.Session{ID: s.SessionID, Cwd: s.Cwd, Name: s.Name, Instance: s.ProcStart, PID: s.PID, Ready: readyForInput(s.Status), Background: s.Status == "shell"})
	}
	return sessions, nil
}

func (a *Adapter) Send(ctx context.Context, target agent.Session, text string) error {
	entries, err := a.metadata()
	if err != nil {
		return err
	}
	for _, s := range entries {
		if s.SessionID != target.ID || s.PID != target.PID || s.ProcStart != target.Instance {
			continue
		}
		tty, alive := a.process(ctx, s)
		if !alive {
			return agent.ErrNoSession
		}
		if !readyForInput(s.Status) {
			return agent.ErrBusy
		}
		if tty == "" {
			return agent.ErrNoTerminal
		}
		return a.writer.WriteText(ctx, tty, text)
	}
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

func processTTY(ctx context.Context, s metadata) (string, bool) {
	if runtime.GOOS != "darwin" {
		return "", false
	}
	cmd := exec.CommandContext(ctx, "/bin/ps", "-o", "tty=,lstart=,comm=", "-p", strconv.Itoa(s.PID))
	// Claude's procStart is UTC, while ps otherwise formats in the local zone.
	cmd.Env = append(os.Environ(), "TZ=UTC", "LC_ALL=C")
	raw, err := cmd.Output()
	if err != nil {
		return "", false
	}
	fields := strings.Fields(string(raw))
	if len(fields) < 7 || strings.Join(fields[1:6], " ") != strings.Join(strings.Fields(s.ProcStart), " ") {
		return "", false
	}
	if !strings.Contains(strings.ToLower(filepath.Base(fields[6])), "claude") {
		return "", false
	}
	if !ttyPattern.MatchString(fields[0]) {
		return "", true
	}
	return "/dev/" + fields[0], true
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

// Summary returns the text of the last final reply (assistant, end_turn, not
// a subagent) logged after since. The log path is found by globbing for the
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
		text, at, ok, err := lastFinalReply(name, since)
		if err != nil {
			return "", time.Time{}, false, err
		}
		if ok && (!found || at.After(bestAt)) {
			bestText, bestAt, found = text, at, true
		}
	}
	return bestText, bestAt, found, nil
}

func lastFinalReply(name string, since time.Time) (string, time.Time, bool, error) {
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
	var (
		text  string
		at    time.Time
		found bool
	)
	for {
		raw, readErr := r.ReadBytes('\n')
		if len(bytes.TrimSpace(raw)) > 0 {
			if t, ts, ok := parseFinalReply(raw); ok && ts.After(since) {
				text, at, found = t, ts, true
			}
		}
		if readErr == io.EOF {
			return text, at, found, nil
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
