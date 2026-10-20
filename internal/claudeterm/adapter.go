// Package claudeterm adapts Claude Code metadata to the shared agent contract.
// Only session JSON metadata is read; keys and internal sockets are not used.
package claudeterm

import (
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
		sessions = append(sessions, agent.Session{ID: s.SessionID, Cwd: s.Cwd, Name: s.Name, Instance: s.ProcStart, PID: s.PID, Ready: readyForInput(s.Status)})
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
