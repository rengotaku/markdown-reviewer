package claudeterm

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
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
	adapter.process = func(_ context.Context, s metadata) (string, bool, error) {
		return "/dev/ttys" + strconv.Itoa(s.PID), s.PID != 99, nil
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
				adapter.process = func(context.Context, metadata) (string, bool, error) { return "", false, nil }
			case "no terminal":
				adapter.process = func(context.Context, metadata) (string, bool, error) { return "", true, nil }
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

// countingProcess wraps the fixture's process check and counts calls per PID.
func countingProcess(adapter *Adapter) map[int]int {
	calls := map[int]int{}
	inner := adapter.process
	adapter.process = func(ctx context.Context, s metadata) (string, bool, error) {
		calls[s.PID]++
		return inner(ctx, s)
	}
	return calls
}

// #399: status polling must not start one `ps` per session on every poll.
func TestSessionsRemembersLiveness(t *testing.T) {
	adapter, put := fixture(t)
	put(metadata{PID: 1, SessionID: "live", Cwd: "/work", Status: "idle"})
	put(metadata{PID: 99, SessionID: "dead", Cwd: "/work", Status: "idle"})
	calls := countingProcess(adapter)

	for range 3 {
		sessions, err := adapter.Sessions(context.Background())
		require.NoError(t, err)
		require.Len(t, sessions, 1)
		require.Equal(t, "live", sessions[0].ID)
	}
	require.Equal(t, map[int]int{1: 1, 99: 1}, calls)
}

func TestSessionsStillReadsStatusEachTime(t *testing.T) {
	adapter, put := fixture(t)
	raw := metadata{PID: 1, SessionID: "s", Cwd: "/work", Status: "idle"}
	put(raw)
	sessions, err := adapter.Sessions(context.Background())
	require.NoError(t, err)
	require.True(t, sessions[0].Ready)

	raw.Status = "busy"
	put(raw)
	sessions, err = adapter.Sessions(context.Background())
	require.NoError(t, err)
	require.False(t, sessions[0].Ready)
}

func TestSessionsChecksANewIncarnation(t *testing.T) {
	adapter, put := fixture(t)
	raw := metadata{PID: 1, SessionID: "s", Cwd: "/work", Status: "idle"}
	put(raw)
	calls := countingProcess(adapter)
	_, err := adapter.Sessions(context.Background())
	require.NoError(t, err)

	raw.ProcStart = "restarted"
	put(raw)
	_, err = adapter.Sessions(context.Background())
	require.NoError(t, err)
	require.Equal(t, 2, calls[1])
}

// A check that could not decide (cut short by the request deadline, ps
// failing to run) is not a "dead" verdict: the next lookup checks again.
func TestSessionsDoesNotRememberAnInconclusiveCheck(t *testing.T) {
	adapter, put := fixture(t)
	put(metadata{PID: 1, SessionID: "s", Cwd: "/work", Status: "idle"})
	live := adapter.process
	adapter.process = func(context.Context, metadata) (string, bool, error) {
		return "", false, context.DeadlineExceeded
	}

	sessions, err := adapter.Sessions(context.Background())
	require.NoError(t, err)
	require.Empty(t, sessions)

	adapter.process = live
	sessions, err = adapter.Sessions(context.Background())
	require.NoError(t, err)
	require.Len(t, sessions, 1)
}

// A remembered "alive" that turns out stale at send time is forgotten, so the
// next lookup no longer offers the exited session.
func TestSendForgetsAnExitedSession(t *testing.T) {
	adapter, put := fixture(t)
	put(metadata{PID: 1, SessionID: "s", Cwd: "/work", Status: "idle"})
	sessions, err := adapter.Sessions(context.Background())
	require.NoError(t, err)
	require.Len(t, sessions, 1)

	adapter.process = func(context.Context, metadata) (string, bool, error) { return "", false, nil }
	require.ErrorIs(t, adapter.Send(context.Background(), sessions[0], "command"), agent.ErrNoSession)

	sessions, err = adapter.Sessions(context.Background())
	require.NoError(t, err)
	require.Empty(t, sessions)
}

// An inconclusive check at send time is reported as such, not as "no session",
// and does not change what is remembered.
func TestSendReportsAnInconclusiveCheck(t *testing.T) {
	adapter, put := fixture(t)
	put(metadata{PID: 1, SessionID: "s", Cwd: "/work", Status: "idle"})
	sessions, err := adapter.Sessions(context.Background())
	require.NoError(t, err)

	live := adapter.process
	adapter.process = func(context.Context, metadata) (string, bool, error) {
		return "", false, context.DeadlineExceeded
	}
	adapter.writer = writerFunc(func(context.Context, string, string) error { t.Fatal("must not deliver"); return nil })
	err = adapter.Send(context.Background(), sessions[0], "command")
	require.ErrorIs(t, err, context.DeadlineExceeded)
	require.NotErrorIs(t, err, agent.ErrNoSession)

	adapter.process = live
	sessions, err = adapter.Sessions(context.Background())
	require.NoError(t, err)
	require.Len(t, sessions, 1)
}

// A check that began before Send found the session gone must not bring it
// back when it finishes later.
func TestADeadVerdictIsNotOverwritten(t *testing.T) {
	adapter, _ := fixture(t)
	key := incarnation{pid: 1, start: "start"}
	require.False(t, adapter.remember(key, false))
	require.False(t, adapter.remember(key, true))
	require.False(t, adapter.liveness[key].alive)
}

// fakeClock lets a test move time past aliveFor.
func fakeClock(adapter *Adapter) *time.Time {
	now := time.Date(2026, 11, 16, 10, 0, 0, 0, time.UTC)
	adapter.now = func() time.Time { return now }
	return &now
}

// FND-6 in #399: a session that exits while busy is never reached by a send,
// so only the expiry can drop it — and with it gone, the status and the send
// move to the live session in the same directory.
func TestAnExitedBusySessionDropsOutAfterExpiry(t *testing.T) {
	adapter, put := fixture(t)
	now := fakeClock(adapter)
	put(metadata{PID: 1, SessionID: "owner", Cwd: "/work", Status: "busy"})
	put(metadata{PID: 2, SessionID: "other", Cwd: "/work", Status: "idle"})
	service := agent.New(adapter)
	require.True(t, service.Register(context.Background(), "/work/a.md", agent.Identity{AgentID: "claude", SessionID: "owner", PID: 1}))
	require.Equal(t, "busy", service.Status(context.Background(), "/work/a.md").State)

	live := adapter.process
	adapter.process = func(ctx context.Context, s metadata) (string, bool, error) {
		if s.PID == 1 {
			return "", false, nil
		}
		return live(ctx, s)
	}
	*now = now.Add(aliveFor - time.Second)
	require.Equal(t, "busy", service.Status(context.Background(), "/work/a.md").State)

	*now = now.Add(2 * time.Second)
	require.Equal(t, "idle", service.Status(context.Background(), "/work/a.md").State)
	require.True(t, service.Send(context.Background(), "/work/a.md").Sent)
}

// An expired "alive" whose re-check cannot decide stays alive, and is checked
// again on the next lookup rather than trusted for another aliveFor.
func TestAnUndecidedRecheckKeepsAlive(t *testing.T) {
	adapter, put := fixture(t)
	now := fakeClock(adapter)
	put(metadata{PID: 1, SessionID: "s", Cwd: "/work", Status: "idle"})
	_, err := adapter.Sessions(context.Background())
	require.NoError(t, err)

	calls := 0
	adapter.process = func(context.Context, metadata) (string, bool, error) {
		calls++
		return "", false, context.DeadlineExceeded
	}
	*now = now.Add(aliveFor)
	for range 2 {
		sessions, err := adapter.Sessions(context.Background())
		require.NoError(t, err)
		require.Len(t, sessions, 1)
	}
	require.Equal(t, 2, calls)
}

// A dead verdict does not expire: the same incarnation cannot come back.
func TestADeadVerdictDoesNotExpire(t *testing.T) {
	adapter, put := fixture(t)
	now := fakeClock(adapter)
	put(metadata{PID: 99, SessionID: "dead", Cwd: "/work", Status: "idle"})
	calls := countingProcess(adapter)
	_, err := adapter.Sessions(context.Background())
	require.NoError(t, err)
	*now = now.Add(10 * aliveFor)
	_, err = adapter.Sessions(context.Background())
	require.NoError(t, err)
	require.Equal(t, 1, calls[99])
}

func TestSessionsForgetsRemovedMetadata(t *testing.T) {
	adapter, put := fixture(t)
	put(metadata{PID: 1, SessionID: "s", Cwd: "/work", Status: "idle"})
	_, err := adapter.Sessions(context.Background())
	require.NoError(t, err)
	require.NoError(t, os.Remove(filepath.Join(adapter.dir, "1.json")))
	_, err = adapter.Sessions(context.Background())
	require.NoError(t, err)
	require.Empty(t, adapter.liveness)
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
		// Read past before the answer, so the reader must cope with it.
		`{"type":"assistant","timestamp":"2026-10-29T00:40:00.500Z","message":{"stop_reason":"end_turn","content":[{"type":"text","text":"`+big+`"}]}}`,
		`{"type":"user","timestamp":"2026-10-29T01:01:00.000Z","message":{"content":"hi"}}`,
		`{"type":"assistant","timestamp":"2026-10-29T01:02:00.000Z","message":{"stop_reason":"tool_use","content":[{"type":"text","text":"working"}]}}`,
		`{"type":"assistant","isSidechain":true,"timestamp":"2026-10-29T01:03:00.000Z","message":{"stop_reason":"end_turn","content":[{"type":"text","text":"sub"}]}}`,
		`{"type":"assistant","timestamp":"2026-10-29T01:04:00.000Z","message":{"stop_reason":"end_turn","content":[{"type":"thinking","thinking":"hm"},{"type":"text","text":"first"},{"type":"text","text":"second"}]}}`,
		`{"type":"assistant","timestamp":"2026-10-29T01:06:00Z","message":{"stop_reason":"end_turn","content":[{"type":"text","text":"last"}]}}`,
		`not json`,
	)
	text, at, ok, err := adapter.Summary(context.Background(), agent.Session{ID: "sess"}, since)
	require.NoError(t, err)
	require.True(t, ok)
	// The turn that answered the send, not the later ones (another file's
	// send, or the reader typing in the terminal) (#374 review).
	require.Equal(t, "first\n\nsecond", text)
	require.Equal(t, time.Date(2026, 10, 29, 1, 4, 0, 0, time.UTC), at)
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

// #402: the claude adapter marks the revalidation and the terminal write as
// separate parts of the send's log line.
func TestSendTimesVerifyAndWrite(t *testing.T) {
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&buf, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })

	adapter, put := fixture(t)
	put(metadata{PID: 1, SessionID: "s", Cwd: "/work", Status: "idle"})
	service := agent.New(adapter)
	require.True(t, service.Send(context.Background(), "/work/a.md").Sent)

	var line map[string]any
	for _, raw := range strings.Split(strings.TrimSpace(buf.String()), "\n") {
		var l map[string]any
		require.NoError(t, json.Unmarshal([]byte(raw), &l))
		if l["msg"] == "agent: send" {
			require.Nil(t, line, "one line per send")
			line = l
		}
	}
	require.NotNil(t, line)
	for _, key := range []string{"choose_ms", "verify_ms", "write_ms", "total_ms"} {
		require.Contains(t, line, key)
	}
}
