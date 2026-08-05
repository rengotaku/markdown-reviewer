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
// asserts on the channel. The fingerprint mirrors what the production emitters
// derive from the file (see stateFingerprint).
func scheduleAndWait(w *Watcher, ev Event, fingerprint string) {
	w.schedule(ev, fingerprint)
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
	fp := stateFingerprint(ev.Sha, ev.Mtime)

	scheduleAndWait(w, ev, fp)
	assert.Equal(t, ev, nextBroadcast(t, ch))

	// Same state again, well outside the debounce window.
	scheduleAndWait(w, ev, fp)
	assertNoBroadcast(t, ch)
}

func TestSchedule_ChangedShaSameMtime_IsBroadcast(t *testing.T) {
	// Same-second double save (#119): the mtime can't tell these apart, so the
	// fingerprint has to carry the content hash.
	t.Parallel()
	w := newWatcherForRoots(t, "works")
	ch, unsubscribe := w.hub.Subscribe()
	defer unsubscribe()

	first := Event{Kind: KindFile, Root: "works", Path: "doc.md", Mtime: "2026-08-05T04:46:58Z", Sha: "sha-1"}
	second := first
	second.Sha = "sha-2"

	scheduleAndWait(w, first, stateFingerprint(first.Sha, first.Mtime))
	assert.Equal(t, first, nextBroadcast(t, ch))

	scheduleAndWait(w, second, stateFingerprint(second.Sha, second.Mtime))
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

	scheduleAndWait(w, first, stateFingerprint(first.Sha, first.Mtime))
	assert.Equal(t, first, nextBroadcast(t, ch))

	scheduleAndWait(w, second, stateFingerprint(second.Sha, second.Mtime))
	assert.Equal(t, second, nextBroadcast(t, ch))
}

func TestSchedule_SamePathDifferentKinds_AreIndependent(t *testing.T) {
	// tree and file events for one write share root+path *and* fingerprint;
	// suppressing one must never suppress the other (they drive different
	// refetches), which is why the memo is keyed by kind too.
	t.Parallel()
	w := newWatcherForRoots(t, "works")
	ch, unsubscribe := w.hub.Subscribe()
	defer unsubscribe()

	tree := Event{Kind: KindTree, Root: "works", Path: "doc.md", Mtime: "2026-08-05T04:46:58Z"}
	file := Event{Kind: KindFile, Root: "works", Path: "doc.md", Mtime: "2026-08-05T04:46:58Z", Sha: "sha-1"}
	fp := stateFingerprint(file.Sha, file.Mtime)

	scheduleAndWait(w, tree, fp)
	assert.Equal(t, tree, nextBroadcast(t, ch))
	scheduleAndWait(w, file, fp)
	assert.Equal(t, file, nextBroadcast(t, ch))
}

func TestSchedule_UnknownState_IsNeverSuppressed(t *testing.T) {
	// An empty fingerprint means the emitter couldn't read the state (file
	// removed or unreadable between the fsnotify event and the stat/read),
	// which proves nothing about whether it changed. Dropping such an event
	// would leave clients stale until their next poll, so identical repeats
	// are still delivered (fail-open).
	t.Parallel()
	w := newWatcherForRoots(t, "works")
	ch, unsubscribe := w.hub.Subscribe()
	defer unsubscribe()

	ev := Event{Kind: KindFile, Root: "works", Path: "doc.md", Mtime: "2026-08-05T04:46:58Z"}

	scheduleAndWait(w, ev, "")
	assert.Equal(t, ev, nextBroadcast(t, ch))
	scheduleAndWait(w, ev, "")
	assert.Equal(t, ev, nextBroadcast(t, ch))
}

func TestStateFingerprint_RequiresBothShaAndMtime(t *testing.T) {
	t.Parallel()
	assert.Empty(t, stateFingerprint("", "2026-08-05T04:46:58Z"), "sha alone is unknown state")
	assert.Empty(t, stateFingerprint("sha-1", ""), "mtime alone is unknown state")
	assert.NotEmpty(t, stateFingerprint("sha-1", "2026-08-05T04:46:58Z"))
	// Distinct states must not collide.
	assert.NotEqual(t,
		stateFingerprint("sha-1", "2026-08-05T04:46:58Z"),
		stateFingerprint("sha-1", "2026-08-05T04:47:10Z"))
	assert.NotEqual(t,
		stateFingerprint("sha-1", "2026-08-05T04:46:58Z"),
		stateFingerprint("sha-2", "2026-08-05T04:46:58Z"))
}

func TestSchedule_UndeliveredEventIsNotRemembered(t *testing.T) {
	// Hub.Broadcast drops an event for any subscriber whose buffer is full.
	// Such a client has its polling disabled while SSE is connected, so the
	// identical follow-up event is the only thing that could still repair it —
	// suppressing that would leave it stale indefinitely.
	t.Parallel()
	w := newWatcherForRoots(t, "works")

	// A subscriber that never reads: fill its buffer so every later Broadcast
	// reports incomplete delivery.
	_, unsubscribeStuck := w.hub.Subscribe()
	defer unsubscribeStuck()
	for i := 0; i < subscriberBuffer; i++ {
		w.hub.Broadcast(Event{Kind: KindTree, Root: "works", Path: "filler.md", Mtime: "m"})
	}
	require.False(t, w.hub.Broadcast(Event{Kind: KindTree, Root: "works", Path: "filler.md", Mtime: "m"}),
		"buffer should be full by now")

	// A live subscriber to observe what actually goes out.
	ch, unsubscribe := w.hub.Subscribe()
	defer unsubscribe()

	ev := Event{Kind: KindFile, Root: "works", Path: "doc.md", Mtime: "2026-08-05T04:46:58Z", Sha: "sha-1"}
	fp := stateFingerprint(ev.Sha, ev.Mtime)

	scheduleAndWait(w, ev, fp)
	assert.Equal(t, ev, nextBroadcast(t, ch))

	w.mu.Lock()
	_, remembered := w.lastSent["file|works|doc.md"]
	w.mu.Unlock()
	assert.False(t, remembered, "an event not delivered to every subscriber must not be remembered")

	// ...so the identical repeat still goes out.
	scheduleAndWait(w, ev, fp)
	assert.Equal(t, ev, nextBroadcast(t, ch))
}

func TestSchedule_NewSubscriberRetiresSuppression(t *testing.T) {
	// Broadcast only proves the event reached each subscriber's channel — the
	// connection can die before the handler flushes it — and a client that
	// connects afterwards never saw it at all. So a new subscription must
	// invalidate what the watcher thinks the audience knows, otherwise an
	// identical follow-up event is suppressed and (since only the active file
	// is reconciled on reconnect) the tree/comments views can stay stale.
	t.Parallel()
	w := newWatcherForRoots(t, "works")
	first, unsubscribeFirst := w.hub.Subscribe()
	defer unsubscribeFirst()

	ev := Event{Kind: KindFile, Root: "works", Path: "doc.md", Mtime: "2026-08-05T04:46:58Z", Sha: "sha-1"}
	fp := stateFingerprint(ev.Sha, ev.Mtime)

	scheduleAndWait(w, ev, fp)
	assert.Equal(t, ev, nextBroadcast(t, first))

	// Suppression is armed for this exact state.
	scheduleAndWait(w, ev, fp)
	assertNoBroadcast(t, first)

	// A reconnect (or a second tab) subscribes: the audience changed, so the
	// same state must be announced again.
	second, unsubscribeSecond := w.hub.Subscribe()
	defer unsubscribeSecond()

	scheduleAndWait(w, ev, fp)
	assert.Equal(t, ev, nextBroadcast(t, second))
	assert.Equal(t, ev, nextBroadcast(t, first))

	// ...and it re-arms for the new audience.
	scheduleAndWait(w, ev, fp)
	assertNoBroadcast(t, second)
}

func TestSchedule_ResetsMemoryAtCap(t *testing.T) {
	// The map is bounded so a long-lived daemon over a large tree can't grow
	// it without limit; a reset only costs one redundant broadcast per key.
	t.Parallel()
	w := newWatcherForRoots(t, "works")

	w.mu.Lock()
	for i := 0; i < maxRememberedEvents; i++ {
		w.lastSent["file|works|doc"+strconv.Itoa(i)+".md"] = sentState{fingerprint: "sha|m"}
	}
	require.Len(t, w.lastSent, maxRememberedEvents)
	w.mu.Unlock()

	// One more remembered state trips the cap: the map is dropped, then
	// repopulated with just this key.
	ev := Event{Kind: KindFile, Root: "works", Path: "overflow.md", Mtime: "2026-08-05T04:46:58Z", Sha: "sha-1"}
	fp := stateFingerprint(ev.Sha, ev.Mtime)
	scheduleAndWait(w, ev, fp)

	w.mu.Lock()
	got := w.lastSent
	w.mu.Unlock()
	assert.Len(t, got, 1)
	assert.Equal(t, fp, got["file|works|overflow.md"].fingerprint)
}
