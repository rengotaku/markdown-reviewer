package agent

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

type summaryAdapter struct {
	text  string
	since time.Time
	at    time.Time
	fakeAdapter
	found bool
}

func (a *summaryAdapter) Summary(_ context.Context, _ Session, since time.Time) (string, time.Time, bool, error) {
	a.since = since
	return a.text, a.at, a.found, nil
}

func newSummaryService(ready bool) (*Service, *summaryAdapter) {
	a := &summaryAdapter{fakeAdapter: fakeAdapter{id: "s", sessions: []Session{{ID: "x", Name: "n", Cwd: "/work", Ready: true}}}}
	a.sessions[0].Ready = ready
	return New(a), a
}

func TestTakeSummary(t *testing.T) {
	ctx := context.Background()
	t.Run("nothing pending", func(t *testing.T) {
		service, _ := newSummaryService(true)
		_, ok := service.TakeSummary(ctx, "/work/a.md")
		require.False(t, ok)
	})
	t.Run("busy session is not asked, pending stays", func(t *testing.T) {
		service, a := newSummaryService(true)
		require.True(t, service.Send(ctx, "/work/a.md").Sent)
		a.sessions[0].Ready = false
		a.found, a.text, a.at = true, "done", time.Now()
		_, ok := service.TakeSummary(ctx, "/work/a.md")
		require.False(t, ok)
		a.sessions[0].Ready = true
		sum, ok := service.TakeSummary(ctx, "/work/a.md")
		require.True(t, ok)
		require.Equal(t, "done", sum.Text)
	})
	t.Run("no end_turn yet keeps pending, then taken once", func(t *testing.T) {
		service, a := newSummaryService(true)
		require.True(t, service.Send(ctx, "/work/a.md").Sent)
		_, ok := service.TakeSummary(ctx, "/work/a.md")
		require.False(t, ok)
		require.False(t, a.since.IsZero())
		a.found, a.text, a.at = true, "result", time.UnixMilli(1788000000000)
		sum, ok := service.TakeSummary(ctx, "/work/a.md")
		require.True(t, ok)
		require.Equal(t, Summary{ID: "s-1788000000000", SentAt: a.since, DoneAt: a.at, AgentID: "s", SessionName: "n", Text: "result"}, sum)
		_, ok = service.TakeSummary(ctx, "/work/a.md")
		require.False(t, ok)
	})
}
