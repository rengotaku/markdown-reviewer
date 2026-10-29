package claudeterm

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"markdown-reviewer/internal/agent"
)

type writerFunc func(context.Context, string, string) error

func (f writerFunc) WriteText(ctx context.Context, tty, text string) error { return f(ctx, tty, text) }

func fixture(t *testing.T) (*Adapter, func(metadata)) {
	t.Helper()
	t.Setenv("CLAUDE_CONFIG_DIR", t.TempDir())
	adapter := New(writerFunc(func(context.Context, string, string) error { return nil }))
	require.NoError(t, os.MkdirAll(adapter.dir, 0700))
	adapter.process = func(_ context.Context, s metadata) (string, bool) {
		return "/dev/ttys" + strconv.Itoa(s.PID), s.PID != 99
	}
	put := func(s metadata) {
		t.Helper()
		if s.ProcStart == "" {
			s.ProcStart = "start"
		}
		if s.Kind == "" {
			s.Kind = "interactive"
		}
		raw, err := json.Marshal(s)
		require.NoError(t, err)
		require.NoError(t, os.WriteFile(filepath.Join(adapter.dir, strconv.Itoa(s.PID)+".json"), raw, 0600))
	}
	return adapter, put
}

func TestNormalizeClaudeState(t *testing.T) {
	for _, status := range []string{"idle", "shell", "busy", "waiting", ""} {
		t.Run(status, func(t *testing.T) {
			adapter, put := fixture(t)
			put(metadata{PID: 1, SessionID: "s", Cwd: "/work", Status: status, Name: "display"})
			sessions, err := adapter.Sessions(context.Background())
			require.NoError(t, err)
			require.Len(t, sessions, 1)
			require.Equal(t, status == "idle" || status == "shell", sessions[0].Ready)
			require.Equal(t, status == "shell", sessions[0].Background)
			require.Equal(t, "display", sessions[0].Name)
			require.Equal(t, "start", sessions[0].Instance)
		})
	}
}

func TestSendRevalidatesMetadata(t *testing.T) {
	for _, tc := range []struct {
		want error
		name string
	}{
		{name: "busy", want: agent.ErrBusy}, {name: "new process incarnation", want: agent.ErrNoSession},
		{name: "dead process", want: agent.ErrNoSession}, {name: "no terminal", want: agent.ErrNoTerminal},
	} {
		t.Run(tc.name, func(t *testing.T) {
			adapter, put := fixture(t)
			raw := metadata{PID: 1, SessionID: "s", Cwd: "/work", Status: "idle"}
			put(raw)
			sessions, err := adapter.Sessions(context.Background())
			require.NoError(t, err)
			require.Len(t, sessions, 1)
			switch tc.name {
			case "busy":
				raw.Status = "busy"
				put(raw)
			case "new process incarnation":
				raw.ProcStart = "new"
				put(raw)
			case "dead process":
				adapter.process = func(context.Context, metadata) (string, bool) { return "", false }
			case "no terminal":
				adapter.process = func(context.Context, metadata) (string, bool) { return "", true }
			}
			adapter.writer = writerFunc(func(context.Context, string, string) error { t.Fatal("must not deliver"); return nil })
			require.ErrorIs(t, adapter.Send(context.Background(), sessions[0], "command"), tc.want)
		})
	}
}

func TestBackgroundShellDelivery(t *testing.T) {
	adapter, put := fixture(t)
	put(metadata{PID: 1, SessionID: "s", Cwd: "/work", Status: "shell"})
	calls := 0
	adapter.writer = writerFunc(func(_ context.Context, tty, text string) error {
		calls++
		require.Equal(t, "/dev/ttys1", tty)
		require.Equal(t, "mr comments '/work/a.md'", text)
		return nil
	})
	service := agent.New(adapter)
	require.True(t, service.Register(context.Background(), "/work/a.md", agent.Identity{AgentID: "claude", SessionID: "s", PID: 1}))
	require.True(t, service.Send(context.Background(), "/work/a.md").Sent)
	require.Equal(t, 1, calls)
}

func TestDiscoveryIgnoresDeadAndInvalidMetadata(t *testing.T) {
	adapter, put := fixture(t)
	put(metadata{PID: 1, SessionID: "live", Cwd: "/work", Status: "idle"})
	put(metadata{PID: 99, SessionID: "dead", Cwd: "/work", Status: "idle"})
	for name, body := range map[string]string{"42.json": `{"pid":1}`, "43.json": "invalid", "44.key": "not JSON"} {
		require.NoError(t, os.WriteFile(filepath.Join(adapter.dir, name), []byte(body), 0600))
	}
	sessions, err := adapter.Sessions(context.Background())
	require.NoError(t, err)
	require.Len(t, sessions, 1)
	require.Equal(t, "live", sessions[0].ID)
}

func TestOpenerIdentity(t *testing.T) {
	t.Setenv("CLAUDE_PID", "123")
	t.Setenv("CLAUDE_CODE_SESSION_ID", "s")
	id, ok := OpenerIdentity()
	require.True(t, ok)
	require.Equal(t, agent.Identity{AgentID: "claude", SessionID: "s", PID: 123}, id)
	t.Setenv("CLAUDE_PID", "invalid")
	_, ok = OpenerIdentity()
	require.False(t, ok)
	t.Setenv("CLAUDE_PID", "123")
	t.Setenv("CLAUDE_CODE_SESSION_ID", "")
	_, ok = OpenerIdentity()
	require.False(t, ok)
}

func writeTranscript(t *testing.T, adapter *Adapter, session string, lines ...string) {
	t.Helper()
	dir := filepath.Join(filepath.Dir(adapter.dir), "projects", "-work-proj")
	require.NoError(t, os.MkdirAll(dir, 0700))
	require.NoError(t, os.WriteFile(filepath.Join(dir, session+".jsonl"), []byte(strings.Join(lines, "\n")+"\n"), 0600))
}

func TestSummaryReadsFinalReply(t *testing.T) {
	adapter, _ := fixture(t)
	since := time.Date(2026, 10, 29, 1, 0, 0, 0, time.UTC)
	big := strings.Repeat("x", 3<<20) // one line well past bufio.Scanner's default cap
	writeTranscript(t, adapter, "sess",
		`{"type":"assistant","timestamp":"2026-10-29T00:30:00.000Z","message":{"stop_reason":"end_turn","content":[{"type":"text","text":"before"}]}}`,
		`{"type":"user","timestamp":"2026-10-29T01:01:00.000Z","message":{"content":"hi"}}`,
		`{"type":"assistant","timestamp":"2026-10-29T01:02:00.000Z","message":{"stop_reason":"tool_use","content":[{"type":"text","text":"working"}]}}`,
		`{"type":"assistant","isSidechain":true,"timestamp":"2026-10-29T01:03:00.000Z","message":{"stop_reason":"end_turn","content":[{"type":"text","text":"sub"}]}}`,
		`{"type":"assistant","timestamp":"2026-10-29T01:04:00.000Z","message":{"stop_reason":"end_turn","content":[{"type":"thinking","thinking":"hm"},{"type":"text","text":"first"},{"type":"text","text":"second"}]}}`,
		`{"type":"assistant","timestamp":"2026-10-29T01:05:00.500Z","message":{"stop_reason":"end_turn","content":[{"type":"text","text":"`+big+`"}]}}`,
		`{"type":"assistant","timestamp":"2026-10-29T01:06:00Z","message":{"stop_reason":"end_turn","content":[{"type":"text","text":"last"}]}}`,
		`not json`,
	)
	text, at, ok, err := adapter.Summary(context.Background(), agent.Session{ID: "sess"}, since)
	require.NoError(t, err)
	require.True(t, ok)
	require.Equal(t, "last", text)
	require.Equal(t, time.Date(2026, 10, 29, 1, 6, 0, 0, time.UTC), at)
}

func TestSummaryJoinsTextAndSkipsOthers(t *testing.T) {
	adapter, _ := fixture(t)
	writeTranscript(t, adapter, "s2",
		`{"type":"assistant","timestamp":"2026-10-29T01:04:00.000Z","message":{"stop_reason":"end_turn","content":[{"type":"thinking","thinking":"hm"},{"type":"text","text":"first"},{"type":"text","text":"second"}]}}`,
		`{"type":"assistant","isSidechain":true,"timestamp":"2026-10-29T01:09:00.000Z","message":{"stop_reason":"end_turn","content":[{"type":"text","text":"sub"}]}}`,
		`{"type":"assistant","timestamp":"2026-10-29T01:10:00.000Z","message":{"stop_reason":"tool_use","content":[{"type":"text","text":"mid"}]}}`,
	)
	text, _, ok, err := adapter.Summary(context.Background(), agent.Session{ID: "s2"}, time.Date(2026, 10, 29, 1, 0, 0, 0, time.UTC))
	require.NoError(t, err)
	require.True(t, ok)
	require.Equal(t, "first\n\nsecond", text)
}

func TestSummaryNoMatch(t *testing.T) {
	adapter, _ := fixture(t)
	_, _, ok, err := adapter.Summary(context.Background(), agent.Session{ID: "missing"}, time.Time{})
	require.NoError(t, err)
	require.False(t, ok)
	writeTranscript(t, adapter, "old", `{"type":"assistant","timestamp":"2026-10-29T00:00:00Z","message":{"stop_reason":"end_turn","content":[{"type":"text","text":"a"}]}}`)
	_, _, ok, err = adapter.Summary(context.Background(), agent.Session{ID: "old"}, time.Date(2026, 10, 29, 1, 0, 0, 0, time.UTC))
	require.NoError(t, err)
	require.False(t, ok)
}
