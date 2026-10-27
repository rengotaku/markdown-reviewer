package agent

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
)

type fakeAdapter struct {
	discoverErr error
	send        func(context.Context, Session, string) error
	id          string
	sessions    []Session
}

func (a *fakeAdapter) ID() string                                  { return a.id }
func (a *fakeAdapter) Sessions(context.Context) ([]Session, error) { return a.sessions, a.discoverErr }
func (a *fakeAdapter) Send(ctx context.Context, session Session, text string) error {
	if a.send != nil {
		return a.send(ctx, session, text)
	}
	return nil
}

func TestSelection(t *testing.T) {
	for _, tc := range []struct {
		name  string
		want  string
		owner Identity
		busy  bool
		stale bool
		sent  bool
	}{
		{name: "deepest", want: "deep", sent: true},
		{name: "registered opener", owner: Identity{AgentID: "alpha", SessionID: "parent", PID: 1}, want: "parent", sent: true},
		{name: "gone opener falls back", owner: Identity{AgentID: "alpha", SessionID: "gone"}, want: "deep", sent: true},
		{name: "busy opener is not redirected", owner: Identity{AgentID: "alpha", SessionID: "parent"}, busy: true, want: "parent", sent: false},
		{name: "pid changed", owner: Identity{AgentID: "alpha", SessionID: "parent", PID: 99}, want: "deep", sent: true},
		{name: "registered session disappears", owner: Identity{AgentID: "alpha", SessionID: "parent"}, stale: true, want: "deep", sent: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			parent := &fakeAdapter{id: "alpha", sessions: []Session{{ID: "parent", Name: "parent", Cwd: "/work", PID: 1, Ready: !tc.busy}}}
			deep := &fakeAdapter{id: "beta", sessions: []Session{{ID: "deep", Name: "deep", Cwd: "/work/unit", Ready: true}, {ID: "sibling", Name: "wrong", Cwd: "/work/unit-other", Ready: true}}}
			service := New(parent, deep)
			if tc.owner.SessionID != "" {
				valid := service.Register(context.Background(), "/work/unit/a.md", tc.owner)
				require.Equal(t, tc.owner.SessionID == "parent" && tc.owner.PID != 99, valid)
			}
			if tc.stale {
				parent.sessions = nil
			}
			result := service.Send(context.Background(), "/work/unit/a.md")
			require.Equal(t, tc.want, result.SessionName)
			require.Equal(t, tc.sent, result.Sent)
		})
	}
}

func TestIdentityIsNamespacedByAdapter(t *testing.T) {
	a := &fakeAdapter{id: "alpha", sessions: []Session{{ID: "same", Cwd: "/work", Ready: true}}}
	b := &fakeAdapter{id: "beta", sessions: []Session{{ID: "same", Cwd: "/work", Ready: true}}}
	service := New(a, b)
	require.True(t, service.Register(context.Background(), "/work/a.md", Identity{AgentID: "beta", SessionID: "same"}))
	require.Equal(t, "beta", service.Send(context.Background(), "/work/a.md").AgentID)
	require.False(t, service.Register(context.Background(), "/work/a.md", Identity{AgentID: "unknown", SessionID: "same"}))
}

func TestFailureResults(t *testing.T) {
	for _, tc := range []struct {
		err    error
		reason string
	}{
		{err: ErrBusy, reason: "busy"}, {err: ErrNoSession, reason: "no_session"},
		{err: ErrNoTerminal, reason: "no_terminal"}, {err: errors.New("Automation denied"), reason: "send_failed"},
	} {
		t.Run(tc.reason, func(t *testing.T) {
			adapter := &fakeAdapter{id: "a", sessions: []Session{{ID: "s", Cwd: "/work", Ready: true}}, send: func(context.Context, Session, string) error { return tc.err }}
			result := New(adapter).Send(context.Background(), "/work/a.md")
			require.False(t, result.Sent)
			require.Equal(t, tc.reason, result.Reason)
		})
	}
	require.Equal(t, "no_session", New().Send(context.Background(), "/work/a.md").Reason)
	broken := &fakeAdapter{id: "broken", discoverErr: errors.New("unavailable")}
	good := &fakeAdapter{id: "good", sessions: []Session{{ID: "s", Cwd: "/work", Ready: true}}}
	require.True(t, New(broken, good).Send(context.Background(), "/work/a.md").Sent)
	require.False(t, New(broken).Register(context.Background(), "/work/a.md", Identity{AgentID: "broken", SessionID: "s"}))
}

func TestDeepestBusySessionIsNotRedirected(t *testing.T) {
	adapter := &fakeAdapter{id: "a", sessions: []Session{
		{ID: "parent", Cwd: "/work", Ready: true}, {ID: "deep", Cwd: "/work/unit", Ready: false},
	}}
	require.Equal(t, "busy", New(adapter).Send(context.Background(), "/work/unit/a.md").Reason)
}

func TestUnavailableOwnerIsNotRedirected(t *testing.T) {
	owner := &fakeAdapter{id: "owner", sessions: []Session{{ID: "s", Cwd: "/work", Ready: true}}}
	other := &fakeAdapter{id: "other", sessions: []Session{{ID: "s", Cwd: "/work/unit", Ready: true}}}
	service := New(owner, other)
	require.True(t, service.Register(context.Background(), "/work/unit/a.md", Identity{AgentID: "owner", SessionID: "s"}))
	owner.discoverErr = errors.New("cannot determine whether owner is alive")
	result := service.Send(context.Background(), "/work/unit/a.md")
	require.False(t, result.Sent)
	require.Equal(t, "no_session", result.Reason)
}

func TestConcurrentSendDoesNotQueue(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	adapter := &fakeAdapter{id: "a", sessions: []Session{{ID: "s", Cwd: "/work", Ready: true}}, send: func(context.Context, Session, string) error {
		close(started)
		<-release
		return nil
	}}
	service := New(adapter)
	done := make(chan Result, 1)
	go func() { done <- service.Send(context.Background(), "/work/a.md") }()
	<-started
	result := service.Send(context.Background(), "/work/a.md")
	close(release)
	require.Equal(t, "busy", result.Reason)
	require.True(t, (<-done).Sent)
}

func TestCommandAndPathBoundary(t *testing.T) {
	require.Equal(t, `mr comments '/work/日本語 '"'"'$().md'`, ReviewCommand("/work/日本語 '$().md"))
	require.False(t, contains("/work/unit", "/work/unit-other/a.md"))
	require.True(t, contains("/work/unit", "/work/unit/a.md"))
}

func TestStatusFollowsSendSelection(t *testing.T) {
	for _, tc := range []struct {
		name     string
		want     string
		sessions []Session
	}{
		{name: "no session", want: "none"},
		{name: "outside cwd", sessions: []Session{{ID: "s", Cwd: "/other", Ready: true}}, want: "none"},
		{name: "idle", sessions: []Session{{ID: "s", Name: "n", Cwd: "/work", Ready: true}}, want: "idle"},
		{name: "busy", sessions: []Session{{ID: "s", Name: "n", Cwd: "/work"}}, want: "busy"},
		{name: "background", sessions: []Session{{ID: "s", Name: "n", Cwd: "/work", Ready: true, Background: true}}, want: "background"},
		{name: "deepest wins", sessions: []Session{{ID: "p", Name: "parent", Cwd: "/work", Ready: true}, {ID: "d", Name: "n", Cwd: "/work/unit"}}, want: "busy"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			sent := false
			adapter := &fakeAdapter{id: "a", sessions: tc.sessions, send: func(context.Context, Session, string) error { sent = true; return nil }}
			status := New(adapter).Status(context.Background(), "/work/unit/a.md")
			require.Equal(t, tc.want, status.State)
			if tc.want != "none" {
				require.Equal(t, "n", status.SessionName)
				require.Equal(t, "a", status.AgentID)
			}
			require.False(t, sent)
		})
	}
}

func TestStatusPrefersRegisteredOwner(t *testing.T) {
	owner := &fakeAdapter{id: "owner", sessions: []Session{{ID: "s", Name: "owner", Cwd: "/work"}}}
	other := &fakeAdapter{id: "other", sessions: []Session{{ID: "s", Name: "deep", Cwd: "/work/unit", Ready: true}}}
	service := New(owner, other)
	require.True(t, service.Register(context.Background(), "/work/unit/a.md", Identity{AgentID: "owner", SessionID: "s"}))
	require.Equal(t, Status{State: "busy", SessionName: "owner", AgentID: "owner"}, service.Status(context.Background(), "/work/unit/a.md"))
	owner.discoverErr = errors.New("unavailable")
	require.Equal(t, Status{State: "none"}, service.Status(context.Background(), "/work/unit/a.md"))
}

func TestStatusDoesNotWaitForSend(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	adapter := &fakeAdapter{id: "a", sessions: []Session{{ID: "s", Cwd: "/work", Ready: true}}, send: func(context.Context, Session, string) error {
		close(started)
		<-release
		return nil
	}}
	service := New(adapter)
	done := make(chan Result, 1)
	go func() { done <- service.Send(context.Background(), "/work/a.md") }()
	<-started
	require.Equal(t, "idle", service.Status(context.Background(), "/work/a.md").State)
	close(release)
	require.True(t, (<-done).Sent)
}
