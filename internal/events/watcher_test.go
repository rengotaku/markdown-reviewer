package events_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"markdown-reviewer/internal/events"
	"markdown-reviewer/internal/files"
	"markdown-reviewer/internal/reviewstore"
)

// waitForEvent drains ch until pred matches or the timeout elapses, so
// tests aren't tripped up by unrelated coalesced events (e.g. a directory
// create firing before the file write settles).
func waitForEvent(t *testing.T, ch <-chan events.Event, timeout time.Duration, pred func(events.Event) bool) events.Event {
	t.Helper()
	deadline := time.After(timeout)
	for {
		select {
		case ev := <-ch:
			if pred(ev) {
				return ev
			}
		case <-deadline:
			t.Fatal("timed out waiting for matching event")
			return events.Event{}
		}
	}
}

func newTestRoots(t *testing.T, name string) (*files.Roots, string) {
	t.Helper()
	dir := t.TempDir()
	resolved, err := filepath.EvalSymlinks(dir)
	require.NoError(t, err)
	roots, err := files.NewRoots([]files.RootSpec{{Name: name, Path: resolved}})
	require.NoError(t, err)
	return roots, resolved
}

// startWatcher starts w.Run in a goroutine and blocks until w.Ready()
// closes (or a generous timeout elapses) before returning, so callers never
// race the initial addTree walk with their own filesystem writes — this is
// what previously made every watcher test structurally flaky under
// parallel/-race load (a fixed time.Sleep is a guess; Ready() is a fact).
func startWatcher(t *testing.T, roots *files.Roots) (*events.Hub, <-chan events.Event, func()) {
	t.Helper()
	hub := events.NewHub()
	w, err := events.NewWatcher(hub, roots)
	require.NoError(t, err)

	ch, unsubscribe := hub.Subscribe()

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		_ = w.Run(ctx)
		close(done)
	}()

	select {
	case <-w.Ready():
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for watcher to finish its initial watch registration")
	}

	stop := func() {
		cancel()
		unsubscribe()
		<-done
	}
	return hub, ch, stop
}

func TestWatcher_CanonicalFileCreate_EmitsTreeAndFile(t *testing.T) {
	t.Parallel()
	roots, root := newTestRoots(t, "works")
	_, ch, stop := startWatcher(t, roots)
	defer stop()

	target := filepath.Join(root, "doc.md")
	require.NoError(t, os.WriteFile(target, []byte("# hello\n"), 0o644))

	// Tree and file events for the same create can arrive in either order
	// (both are scheduled independently), so collect both kinds seen for
	// this path rather than assuming a fixed order.
	seen := map[events.Kind]events.Event{}
	deadline := time.After(5 * time.Second)
	for len(seen) < 2 {
		select {
		case ev := <-ch:
			if ev.Path == "doc.md" && (ev.Kind == events.KindTree || ev.Kind == events.KindFile) {
				seen[ev.Kind] = ev
			}
		case <-deadline:
			t.Fatalf("timed out waiting for tree+file events, got: %+v", seen)
		}
	}
	assert.Equal(t, "works", seen[events.KindTree].Root)
	assert.NotEmpty(t, seen[events.KindTree].Mtime)
	assert.Equal(t, "works", seen[events.KindFile].Root)
}

func TestWatcher_CanonicalFileUpdate_EmitsFile(t *testing.T) {
	t.Parallel()
	roots, root := newTestRoots(t, "works")
	target := filepath.Join(root, "doc.md")
	require.NoError(t, os.WriteFile(target, []byte("# hello\n"), 0o644))

	_, ch, stop := startWatcher(t, roots)
	defer stop()

	require.NoError(t, os.WriteFile(target, []byte("# updated\n"), 0o644))

	got := waitForEvent(t, ch, 5*time.Second, func(e events.Event) bool {
		return e.Kind == events.KindFile && e.Path == "doc.md"
	})
	assert.Equal(t, "works", got.Root)
}

func TestWatcher_CanonicalFileAtomicSave_DetectedAsUpdate(t *testing.T) {
	// Editors frequently save via write-to-temp + rename over the target
	// (the same pattern internal/handler.atomicWrite uses). The rename must
	// still surface as a file/tree event for the final target name.
	t.Parallel()
	roots, root := newTestRoots(t, "works")
	target := filepath.Join(root, "doc.md")
	require.NoError(t, os.WriteFile(target, []byte("# hello\n"), 0o644))

	_, ch, stop := startWatcher(t, roots)
	defer stop()

	tmp := filepath.Join(root, ".tmp-mr-atomic")
	require.NoError(t, os.WriteFile(tmp, []byte("# atomic save\n"), 0o644))
	require.NoError(t, os.Rename(tmp, target))

	got := waitForEvent(t, ch, 5*time.Second, func(e events.Event) bool {
		return e.Kind == events.KindFile && e.Path == "doc.md"
	})
	assert.Equal(t, "works", got.Root)
}

// waitForEventNonFatal is like waitForEvent but returns ok=false on timeout
// instead of failing the test, so callers can retry a probe write instead of
// depending on a fixed sleep to guess when async setup (e.g. a new watch
// registration) has completed.
func waitForEventNonFatal(ch <-chan events.Event, timeout time.Duration, pred func(events.Event) bool) (events.Event, bool) {
	deadline := time.After(timeout)
	for {
		select {
		case ev := <-ch:
			if pred(ev) {
				return ev, true
			}
		case <-deadline:
			return events.Event{}, false
		}
	}
}

// waitForSubdirWatched polls by writing (and removing) a disposable probe
// file inside dir until a matching file event proves the directory's watch
// registration has actually landed — replacing a fixed time.Sleep guess with
// a condition that's true by construction once it returns. probePath is the
// root-relative slash path the event is expected to carry.
func waitForSubdirWatched(t *testing.T, ch <-chan events.Event, dir, probePath string) {
	t.Helper()
	probeFile := filepath.Join(dir, ".probe-watch-ready.md")
	// Each retry must wait comfortably longer than the watcher's own
	// debounceWindow (200ms): the probe's file event is coalesced and only
	// broadcast after that window elapses, so a shorter per-retry wait would
	// spuriously read as "not watched yet" even when it is.
	const perRetryWait = 500 * time.Millisecond
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		require.NoError(t, os.WriteFile(probeFile, []byte("probe"), 0o644))
		if _, ok := waitForEventNonFatal(ch, perRetryWait, func(e events.Event) bool {
			return e.Kind == events.KindFile && e.Path == probePath
		}); ok {
			_ = os.Remove(probeFile)
			return
		}
		_ = os.Remove(probeFile)
	}
	t.Fatalf("timed out waiting for watch registration on %s", dir)
}

func TestWatcher_NewSubdirectory_IsWatchedDynamically(t *testing.T) {
	t.Parallel()
	roots, root := newTestRoots(t, "works")
	_, ch, stop := startWatcher(t, roots)
	defer stop()

	sub := filepath.Join(root, "nested")
	require.NoError(t, os.Mkdir(sub, 0o755))
	// Poll (via a disposable probe write) until the watcher's Create handler
	// has actually registered a watch on the new directory, instead of
	// assuming a fixed sleep is long enough — this is what made the test
	// flaky under parallel/-race load, where watch registration can take
	// longer than a fixed guess.
	waitForSubdirWatched(t, ch, sub, "nested/.probe-watch-ready.md")

	require.NoError(t, os.WriteFile(filepath.Join(sub, "child.md"), []byte("# child\n"), 0o644))

	got := waitForEvent(t, ch, 5*time.Second, func(e events.Event) bool {
		return e.Kind == events.KindFile && e.Path == "nested/child.md"
	})
	assert.Equal(t, "works", got.Root)
}

func TestWatcher_NonMarkdownFile_NoEvent(t *testing.T) {
	t.Parallel()
	roots, root := newTestRoots(t, "works")
	_, ch, stop := startWatcher(t, roots)
	defer stop()

	require.NoError(t, os.WriteFile(filepath.Join(root, "notes.txt"), []byte("hi"), 0o644))

	select {
	case ev := <-ch:
		t.Fatalf("unexpected event for non-markdown file: %+v", ev)
	case <-time.After(500 * time.Millisecond):
		// No event — correct.
	}
}

func TestWatcher_SidecarUpdate_EmitsComments(t *testing.T) {
	// Not t.Parallel(): t.Setenv forbids it.
	configDir := t.TempDir()
	t.Setenv("REVIEWER_CONFIG_DIR", configDir)

	roots, root := newTestRoots(t, "works")
	require.NoError(t, os.WriteFile(filepath.Join(root, "doc.md"), []byte("# hello\n"), 0o644))
	require.NoError(t, reviewstore.Ingest("works", "doc.md"))

	_, ch, stop := startWatcher(t, roots)
	defer stop()

	entryDir, err := reviewstore.EntryDir("works", "doc.md")
	require.NoError(t, err)
	reviewJSON := filepath.Join(entryDir, reviewstore.ReviewFileName)
	require.NoError(t, os.WriteFile(reviewJSON, []byte(`{"comments":[]}`), 0o644))

	got := waitForEvent(t, ch, 5*time.Second, func(e events.Event) bool {
		return e.Kind == events.KindComments && e.Path == "doc.md"
	})
	assert.Equal(t, "works", got.Root)
	assert.NotEmpty(t, got.Mtime)
}

func TestWatcher_DebounceCoalescesBurstIntoOneEvent(t *testing.T) {
	t.Parallel()
	roots, root := newTestRoots(t, "works")
	_, ch, stop := startWatcher(t, roots)
	defer stop()

	target := filepath.Join(root, "doc.md")
	for i := 0; i < 5; i++ {
		require.NoError(t, os.WriteFile(target, []byte("rev"), 0o644))
		time.Sleep(10 * time.Millisecond)
	}

	// First matching event should arrive well after the debounce window.
	waitForEvent(t, ch, 5*time.Second, func(e events.Event) bool {
		return e.Kind == events.KindFile && e.Path == "doc.md"
	})

	// No further KindFile "doc.md" events should follow immediately after —
	// the burst must have been coalesced into a single broadcast.
	select {
	case ev := <-ch:
		if ev.Kind == events.KindFile && ev.Path == "doc.md" {
			t.Fatalf("burst was not coalesced: got a second file event %+v", ev)
		}
	case <-time.After(400 * time.Millisecond):
		// No extra event — correct.
	}
}
