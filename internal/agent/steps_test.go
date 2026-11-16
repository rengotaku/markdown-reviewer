package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// captureSendLogs swaps the default logger for the test and returns the
// "agent: send" lines written while it runs, decoded.
func captureSendLogs(t *testing.T) func() []map[string]any {
	t.Helper()
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&buf, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return func() []map[string]any {
		var lines []map[string]any
		for _, raw := range strings.Split(strings.TrimSpace(buf.String()), "\n") {
			if raw == "" {
				continue
			}
			var line map[string]any
			require.NoError(t, json.Unmarshal([]byte(raw), &line))
			if line["msg"] == "agent: send" {
				lines = append(lines, line)
			}
		}
		return lines
	}
}

func TestTimeStepWithoutRecorderDoesNothing(t *testing.T) {
	done := TimeStep(context.Background(), "write")
	require.NotPanics(t, done)
}

func TestSendLogsOneLineWithStepTimings(t *testing.T) {
	logs := captureSendLogs(t)
	adapter := &fakeAdapter{
		id:       "alpha",
		sessions: []Session{{ID: "s", Name: "s", Cwd: "/work", Ready: true}},
		send: func(ctx context.Context, _ Session, _ string) error {
			TimeStep(ctx, "verify")()
			TimeStep(ctx, "write")()
			return nil
		},
	}
	result := New(adapter).Send(context.Background(), "/work/a.md")
	require.True(t, result.Sent)

	lines := logs()
	require.Len(t, lines, 1)
	line := lines[0]
	require.Equal(t, true, line["sent"])
	require.Equal(t, "", line["reason"])
	require.Equal(t, "alpha", line["agent"])
	for _, key := range []string{"total_ms", "choose_ms", "verify_ms", "write_ms"} {
		require.Contains(t, line, key)
	}
}

func TestSendLogsTheReasonWhenNothingWasSent(t *testing.T) {
	logs := captureSendLogs(t)
	adapter := &fakeAdapter{
		id:       "alpha",
		sessions: []Session{{ID: "s", Name: "s", Cwd: "/work", Ready: false}},
		send: func(context.Context, Session, string) error {
			t.Fatal("must not deliver to a busy session")
			return nil
		},
	}
	result := New(adapter).Send(context.Background(), "/work/a.md")
	require.False(t, result.Sent)

	lines := logs()
	require.Len(t, lines, 1)
	require.Equal(t, false, lines[0]["sent"])
	require.Equal(t, "busy", lines[0]["reason"])
	require.Contains(t, lines[0], "choose_ms")
	require.NotContains(t, lines[0], "write_ms")
}
