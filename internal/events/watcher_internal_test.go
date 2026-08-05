package events

import (
	"errors"
	"os"
	"path/filepath"
	"strconv"
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

// --- unchanged-state suppression (issue #176) --------------------------------

// nextBroadcast returns the next event on ch, or fails if none arrives. Used
// instead of a bare receive so a suppression bug surfaces as "timed out
// waiting for the first broadcast" rather than a hang.
func nextBroadcast(t *testing.T, ch <-chan Event) Event {
	t.Helper()
	select {
	case ev := <-ch:
		return ev
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for a broadcast")
		return Event{}
	}
}

// assertNoBroadcast fails if anything is broadcast within the grace period.
func assertNoBroadcast(t *testing.T, ch <-chan Event) {
	t.Helper()
	select {
	case ev := <-ch:
		t.Fatalf("unexpected broadcast: %+v", ev)
	case <-time.After(debounceWindow * 3):
	}
}

// scheduleAndWait drives schedule() and waits out the debounce window so the
// timer has fired (successfully broadcasting or suppressing) before the test
// asserts on the channel.
func scheduleAndWait(w *Watcher, ev Event) {
	w.schedule(ev)
	time.Sleep(debounceWindow * 2)
}

// TestSchedule_IdenticalPayloadAcrossDebounceWindow_BroadcastsOnce is the
// core regression for issue #176: debouncing only collapses bursts inside its
// window, so a second fsnotify event landing after it (a tool rewriting the
// same bytes 300ms later, a repeated `touch` to the same timestamp) used to
// re-announce a state every client already had.
func TestSchedule_IdenticalPayloadAcrossDebounceWindow_BroadcastsOnce(t *testing.T) {
	t.Parallel()
	w := newWatcherForRoots(t, "works")
	ch, unsubscribe := w.hub.Subscribe()
	defer unsubscribe()

	ev := Event{Kind: KindFile, Root: "works", Path: "doc.md", Mtime: "2026-08-05T04:46:58Z", Sha: "sha-1"}

	scheduleAndWait(w, ev)
	assert.Equal(t, ev, nextBroadcast(t, ch))

	// Same state again, well outside the debounce window.
	scheduleAndWait(w, ev)
	assertNoBroadcast(t, ch)
}

func TestSchedule_ChangedShaSameMtime_IsBroadcast(t *testing.T) {
	// Same-second double save (#119): the mtime can't tell these apart, so
	// suppression must key on the whole payload — sha included.
	t.Parallel()
	w := newWatcherForRoots(t, "works")
	ch, unsubscribe := w.hub.Subscribe()
	defer unsubscribe()

	first := Event{Kind: KindFile, Root: "works", Path: "doc.md", Mtime: "2026-08-05T04:46:58Z", Sha: "sha-1"}
	second := first
	second.Sha = "sha-2"

	scheduleAndWait(w, first)
	assert.Equal(t, first, nextBroadcast(t, ch))

	scheduleAndWait(w, second)
	assert.Equal(t, second, nextBroadcast(t, ch))
}

func TestSchedule_SameShaNewMtime_IsBroadcast(t *testing.T) {
	// A touch (bytes unchanged, mtime bumped) is a real state change the
	// client reconciles against — the frontend acknowledges the new mtime so
	// later comparisons stay on the sha-first path.
	t.Parallel()
	w := newWatcherForRoots(t, "works")
	ch, unsubscribe := w.hub.Subscribe()
	defer unsubscribe()

	first := Event{Kind: KindFile, Root: "works", Path: "doc.md", Mtime: "2026-08-05T04:46:58Z", Sha: "sha-1"}
	second := first
	second.Mtime = "2026-08-05T04:47:10Z"

	scheduleAndWait(w, first)
	assert.Equal(t, first, nextBroadcast(t, ch))

	scheduleAndWait(w, second)
	assert.Equal(t, second, nextBroadcast(t, ch))
}

func TestSchedule_SamePathDifferentKinds_AreIndependent(t *testing.T) {
	// tree and file events for one write share root+path; suppressing one
	// must never suppress the other (they drive different refetches).
	t.Parallel()
	w := newWatcherForRoots(t, "works")
	ch, unsubscribe := w.hub.Subscribe()
	defer unsubscribe()

	tree := Event{Kind: KindTree, Root: "works", Path: "doc.md", Mtime: "2026-08-05T04:46:58Z"}
	file := Event{Kind: KindFile, Root: "works", Path: "doc.md", Mtime: "2026-08-05T04:46:58Z", Sha: "sha-1"}

	scheduleAndWait(w, tree)
	assert.Equal(t, tree, nextBroadcast(t, ch))
	scheduleAndWait(w, file)
	assert.Equal(t, file, nextBroadcast(t, ch))
}

func TestSchedule_MissingIdentityFields_AreNeverSuppressed(t *testing.T) {
	// An empty sha/mtime means the emitter couldn't read that state (file
	// removed or unreadable between the fsnotify event and the stat/read),
	// which proves nothing about whether it changed. Dropping such an event
	// would leave clients stale until their next poll, so identical repeats
	// are still delivered (fail-open).
	t.Parallel()
	cases := []struct {
		name string
		ev   Event
	}{
		{"file without sha", Event{Kind: KindFile, Root: "works", Path: "doc.md", Mtime: "2026-08-05T04:46:58Z"}},
		{"file without mtime", Event{Kind: KindFile, Root: "works", Path: "doc.md", Sha: "sha-1"}},
		{"tree without mtime", Event{Kind: KindTree, Root: "works", Path: "doc.md"}},
		{"comments without mtime", Event{Kind: KindComments, Root: "works", Path: "doc.md"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			w := newWatcherForRoots(t, "works")
			ch, unsubscribe := w.hub.Subscribe()
			defer unsubscribe()

			scheduleAndWait(w, tc.ev)
			assert.Equal(t, tc.ev, nextBroadcast(t, ch))
			scheduleAndWait(w, tc.ev)
			assert.Equal(t, tc.ev, nextBroadcast(t, ch))
		})
	}
}

func TestAcceptLocked_ResetsMemoryAtCap(t *testing.T) {
	// The map is bounded so a long-lived daemon over a large tree can't grow
	// it without limit; a reset only costs one redundant broadcast per key.
	t.Parallel()
	w := newWatcherForRoots(t, "works")

	w.mu.Lock()
	defer w.mu.Unlock()
	for i := 0; i < maxRememberedEvents; i++ {
		ev := Event{Kind: KindFile, Root: "works", Path: "doc" + strconv.Itoa(i) + ".md", Mtime: "m", Sha: "s"}
		require.True(t, w.acceptLocked(string(ev.Kind)+"|"+ev.Root+"|"+ev.Path, ev))
	}
	require.Len(t, w.lastSent, maxRememberedEvents)

	// One more entry trips the cap: the map is dropped, then repopulated with
	// just this event.
	overflow := Event{Kind: KindFile, Root: "works", Path: "overflow.md", Mtime: "m", Sha: "s"}
	assert.True(t, w.acceptLocked("file|works|overflow.md", overflow))
	assert.Len(t, w.lastSent, 1)
	// The freshly-remembered event is still suppressed on an exact repeat.
	assert.False(t, w.acceptLocked("file|works|overflow.md", overflow))
}
