package agent

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestRegistrationSurvivesRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "owners.json")
	adapter := &fakeAdapter{id: "a", sessions: []Session{
		{ID: "owner", Name: "owner", Cwd: "/elsewhere", PID: 7, Ready: true},
	}}
	first := New(adapter)
	first.Persist(context.Background(), path)
	require.True(t, first.Register(context.Background(), "/reviews/a.md", Identity{AgentID: "a", SessionID: "owner", PID: 7}))

	// A fresh service is what a restarted server builds.
	restarted := New(adapter)
	restarted.Persist(context.Background(), path)
	require.Equal(t, Status{State: "idle", SessionName: "owner", AgentID: "a"}, restarted.Status(context.Background(), "/reviews/a.md"))
}

func TestPersistDropsSessionsThatEnded(t *testing.T) {
	path := filepath.Join(t.TempDir(), "owners.json")
	adapter := &fakeAdapter{id: "a", sessions: []Session{
		{ID: "gone", Cwd: "/x", PID: 1, Ready: true},
		{ID: "kept", Cwd: "/x", PID: 2, Ready: true},
	}}
	first := New(adapter)
	first.Persist(context.Background(), path)
	require.True(t, first.Register(context.Background(), "/r/gone.md", Identity{AgentID: "a", SessionID: "gone", PID: 1}))
	require.True(t, first.Register(context.Background(), "/r/kept.md", Identity{AgentID: "a", SessionID: "kept", PID: 2}))

	// "gone" ended; "kept" was restarted under the same session id but a new
	// process, which is a different session for routing purposes.
	adapter.sessions = []Session{{ID: "kept", Cwd: "/x", PID: 3, Ready: true}}
	restarted := New(adapter)
	restarted.Persist(context.Background(), path)
	require.Equal(t, "none", restarted.Status(context.Background(), "/r/gone.md").State)
	require.Equal(t, "none", restarted.Status(context.Background(), "/r/kept.md").State)

	var saved ownersFile
	raw, err := os.ReadFile(path)
	require.NoError(t, err)
	require.NoError(t, json.Unmarshal(raw, &saved))
	require.Empty(t, saved.Owners, "dead registrations are not written back")
}

func TestPersistToleratesBadFiles(t *testing.T) {
	adapter := &fakeAdapter{id: "a", sessions: []Session{{ID: "s", Cwd: "/x", Ready: true}}}
	for name, content := range map[string]string{
		"corrupt":       "{not json",
		"wrong version": `{"version":99,"owners":{"/r/a.md":{"agent_id":"a","session_id":"s"}}}`,
		"relative path": `{"version":1,"owners":{"r/a.md":{"agent_id":"a","session_id":"s"}}}`,
	} {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "owners.json")
			require.NoError(t, os.WriteFile(path, []byte(content), 0o600))
			service := New(adapter)
			service.Persist(context.Background(), path)
			require.Equal(t, "none", service.Status(context.Background(), "/r/a.md").State)
			require.True(t, service.Register(context.Background(), "/r/b.md", Identity{AgentID: "a", SessionID: "s"}))
		})
	}
	t.Run("missing", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "sub", "owners.json")
		service := New(adapter)
		service.Persist(context.Background(), path)
		require.True(t, service.Register(context.Background(), "/r/b.md", Identity{AgentID: "a", SessionID: "s"}))
		info, err := os.Stat(path)
		require.NoError(t, err)
		require.Equal(t, os.FileMode(0o600), info.Mode().Perm())
	})
}

func TestPersistKeepsRegistrationsMadeBeforeLoading(t *testing.T) {
	path := filepath.Join(t.TempDir(), "owners.json")
	adapter := &fakeAdapter{id: "a", sessions: []Session{
		{ID: "old", Name: "old", Cwd: "/x", Ready: true}, {ID: "new", Name: "new", Cwd: "/x", Ready: true},
	}}
	require.NoError(t, writeOwners(path, map[string]Identity{"/r/a.md": {AgentID: "a", SessionID: "old"}}))
	service := New(adapter)
	require.True(t, service.Register(context.Background(), "/r/a.md", Identity{AgentID: "a", SessionID: "new"}))
	service.Persist(context.Background(), path)
	require.Equal(t, "new", service.Status(context.Background(), "/r/a.md").SessionName)
}

func TestPersistKeepsEntriesItCouldNotCheck(t *testing.T) {
	for _, tc := range []struct {
		ctx    func() context.Context
		name   string
		broken bool
	}{
		{name: "adapter error", ctx: context.Background, broken: true},
		{name: "deadline passed", ctx: func() context.Context {
			ctx, cancel := context.WithCancel(context.Background())
			cancel()
			return ctx
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "owners.json")
			adapter := &fakeAdapter{id: "a", sessions: []Session{{ID: "s", Name: "s", Cwd: "/x", PID: 4, Ready: true}}}
			first := New(adapter)
			first.Persist(context.Background(), path)
			require.True(t, first.Register(context.Background(), "/r/a.md", Identity{AgentID: "a", SessionID: "s", PID: 4}))

			if tc.broken {
				adapter.discoverErr = errors.New("probe failed")
			}
			restarted := New(adapter)
			restarted.Persist(tc.ctx(), path)
			adapter.discoverErr = nil
			require.Equal(t, "s", restarted.Status(context.Background(), "/r/a.md").SessionName)

			var saved ownersFile
			raw, err := os.ReadFile(path)
			require.NoError(t, err)
			require.NoError(t, json.Unmarshal(raw, &saved))
			require.Contains(t, saved.Owners, "/r/a.md")
		})
	}
}

func TestPersistMatchesEachProcessOfASession(t *testing.T) {
	path := filepath.Join(t.TempDir(), "owners.json")
	adapter := &fakeAdapter{id: "a", sessions: []Session{
		{ID: "s", Name: "first", Cwd: "/x", PID: 1, Ready: true},
		{ID: "s", Name: "second", Cwd: "/x", PID: 2, Ready: true},
	}}
	first := New(adapter)
	first.Persist(context.Background(), path)
	require.True(t, first.Register(context.Background(), "/r/one.md", Identity{AgentID: "a", SessionID: "s", PID: 1}))
	require.True(t, first.Register(context.Background(), "/r/two.md", Identity{AgentID: "a", SessionID: "s", PID: 2}))

	restarted := New(adapter)
	restarted.Persist(context.Background(), path)
	require.Equal(t, "first", restarted.Status(context.Background(), "/r/one.md").SessionName)
	require.Equal(t, "second", restarted.Status(context.Background(), "/r/two.md").SessionName)
}
