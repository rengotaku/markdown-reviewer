package events

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
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

// TestAddTree_RefusesPathOutsideAllowedRoots is the regression test for
// issue #135: addTree must never walk a path that isn't inside a
// configured REVIEW_ROOT (or the reviewstore sidecar base). Without the
// gate a stray fsnotify Create event with an unexpected Name (empty, ".",
// or the launchd cwd of "/") turned into an unbounded walk that tried to
// watch /Applications, /Library, /System, /Users, ... exhausting the
// process FD limit and returning 500 from ingest / PUT endpoints.
func TestAddTree_RefusesPathOutsideAllowedRoots(t *testing.T) {
	t.Parallel()
	// The watcher's only configured root is the tempdir created by
	// newWatcherForRoots("works"); "outside" is a separate tempdir so it
	// necessarily sits outside every allowedRoot.
	w := newWatcherForRoots(t, "works")

	outside := t.TempDir()
	outsideResolved, err := filepath.EvalSymlinks(outside)
	require.NoError(t, err)
	// Populate a subdirectory so a version without the gate would call
	// fsw.Add on it — the assertion below can then distinguish "gate
	// refused" from "gate allowed but nothing to walk".
	require.NoError(t, os.Mkdir(filepath.Join(outsideResolved, "sub"), 0o755))

	require.NoError(t, w.addTree(outsideResolved))

	for _, p := range w.fsw.WatchList() {
		require.False(t, strings.HasPrefix(p, outsideResolved),
			"addTree walked outside the configured roots: %s watched", p)
	}
}

// TestAddTree_RefusesRelativePath ensures the defense also holds for the
// exact shape observed in the incident log: paths like "." resolve
// against the process cwd (which is "/" for launchd agents), and a
// relative "." must never turn into a walk of "/".
func TestAddTree_RefusesRelativePath(t *testing.T) {
	t.Parallel()
	w := newWatcherForRoots(t, "works")

	// "." resolves to the test binary's cwd, which is not one of the
	// configured tempdir roots — so the gate must refuse it.
	require.NoError(t, w.addTree("."))

	// Empty string is treated the same way.
	require.NoError(t, w.addTree(""))

	// No watches were registered as a side effect.
	assert.Empty(t, w.fsw.WatchList())
}

// TestAddTree_AllowsConfiguredRoot proves the gate isn't overzealous:
// a walk that starts at an allowed root succeeds and populates the
// watch list (this is what production Run() relies on).
func TestAddTree_AllowsConfiguredRoot(t *testing.T) {
	t.Parallel()
	w := newWatcherForRoots(t, "works")
	root := w.roots.List()[0].Resolver.Root()

	require.NoError(t, w.addTree(root))

	assert.Contains(t, w.fsw.WatchList(), root)
}
