package events

import (
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"markdown-reviewer/internal/files"
)

// newWatcherForRoots is a package-internal helper mirroring the
// events_test.go newTestRoots/NewWatcher pair, used here so handleFsError
// can be exercised directly (it's unexported) without going through a real
// fsnotify.Watcher.Errors channel, which fsnotify never exposes a way to
// feed synthetically from outside the package.
func newWatcherForRoots(t *testing.T, names ...string) *Watcher {
	t.Helper()
	specs := make([]files.RootSpec, 0, len(names))
	for _, name := range names {
		dir := t.TempDir()
		resolved, err := filepath.EvalSymlinks(dir)
		require.NoError(t, err)
		specs = append(specs, files.RootSpec{Name: name, Path: resolved})
	}
	roots, err := files.NewRoots(specs)
	require.NoError(t, err)

	hub := NewHub()
	w, err := NewWatcher(hub, roots)
	require.NoError(t, err)
	t.Cleanup(func() { _ = w.fsw.Close() })
	return w
}

func TestHandleFsError_EventOverflow_BroadcastsTreeForEveryRoot(t *testing.T) {
	t.Parallel()
	w := newWatcherForRoots(t, "works", "rooms")

	ch, unsubscribe := w.hub.Subscribe()
	defer unsubscribe()

	w.handleFsError(fsnotify.ErrEventOverflow)

	seenRoots := map[string]bool{}
	deadline := time.After(time.Second)
	for len(seenRoots) < 2 {
		select {
		case ev := <-ch:
			require.Equal(t, KindTree, ev.Kind)
			seenRoots[ev.Root] = true
		case <-deadline:
			t.Fatalf("timed out waiting for a tree broadcast per root, got: %v", seenRoots)
		}
	}
	assert.True(t, seenRoots["works"])
	assert.True(t, seenRoots["rooms"])
}

func TestHandleFsError_NonOverflowError_NoBroadcast(t *testing.T) {
	t.Parallel()
	w := newWatcherForRoots(t, "works")

	ch, unsubscribe := w.hub.Subscribe()
	defer unsubscribe()

	w.handleFsError(errors.New("some unrelated fsnotify error"))

	select {
	case ev := <-ch:
		t.Fatalf("unexpected broadcast for a non-overflow error: %+v", ev)
	case <-time.After(200 * time.Millisecond):
		// No broadcast — correct.
	}
}

func TestHandleFsError_EventOverflow_NilRoots_NoPanic(t *testing.T) {
	t.Parallel()
	hub := NewHub()
	w, err := NewWatcher(hub, nil)
	require.NoError(t, err)
	t.Cleanup(func() { _ = w.fsw.Close() })

	assert.NotPanics(t, func() {
		w.handleFsError(fsnotify.ErrEventOverflow)
	})
}
