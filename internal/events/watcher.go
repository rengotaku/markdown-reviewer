package events

import (
	"context"
	"errors"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"

	"markdown-reviewer/internal/files"
	"markdown-reviewer/internal/reviewstore"
)

// debounceWindow coalesces bursts of fsnotify events for the same logical
// change (editors frequently emit write+chmod, or remove+create for an
// atomic save) into a single broadcast Event.
const debounceWindow = 200 * time.Millisecond

// maxRememberedEvents bounds the lastSent map (issue #176). One entry per
// (kind, root, path) that has ever changed while the process ran, so a
// long-lived daemon over a large tree could otherwise grow it without limit.
// On overflow the whole map is dropped rather than evicting one entry at a
// time: the only cost of forgetting a key is one redundant broadcast the next
// time that path changes, so an O(1) reset beats the bookkeeping an LRU needs.
const maxRememberedEvents = 4096

// Watcher watches every configured root (canonical .md tree) plus the
// reviewstore sidecar tree (review.json files) and pushes coalesced change
// notifications to a Hub. fsnotify only watches individual directories (not
// recursively), so Watcher walks each root up-front and adds any
// newly-created subdirectory as it appears.
type Watcher struct {
	hub   *Hub
	roots *files.Roots
	fsw   *fsnotify.Watcher

	// ready is closed once Run has finished registering the initial watch
	// set (every canonical root + any already-existing sidecar tree) and is
	// about to enter its event loop. See Ready.
	ready chan struct{}

	timers  map[string]*time.Timer
	pending map[string]pendingEvent

	// lastSent remembers the state most recently broadcast (and accepted by
	// every subscriber) per debounce key, so an unchanged state isn't
	// re-announced (issue #176). Bounded by maxRememberedEvents.
	lastSent map[string]sentState

	mu sync.Mutex
}

// pendingEvent is a debounced event plus the fingerprint of the on-disk state
// it describes. The fingerprint is deliberately not part of Event: it can be
// content-precise (a sha) even for kinds whose wire payload carries no sha.
type pendingEvent struct {
	ev          Event
	fingerprint string
}

// sentState is what the watcher believes connected clients already know: a
// state fingerprint plus the Hub subscriber epoch it was sent under.
//
// The epoch is what keeps "they already have this" honest. Enqueueing into a
// subscriber's channel isn't proof the bytes reached the browser (the
// connection can die before the handler flushes), and a client that connects
// later never saw the event at all. Both cases bump the epoch, which retires
// every memo, so the next event — even an identical one — is delivered.
type sentState struct {
	fingerprint string
	epoch       uint64
}

// NewWatcher creates a Watcher for the given roots, broadcasting through
// hub. Call Run to start watching; Run blocks until ctx is canceled.
func NewWatcher(hub *Hub, roots *files.Roots) (*Watcher, error) {
	fsw, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	return &Watcher{
		hub:      hub,
		roots:    roots,
		fsw:      fsw,
		ready:    make(chan struct{}),
		timers:   make(map[string]*time.Timer),
		pending:  make(map[string]pendingEvent),
		lastSent: make(map[string]sentState),
	}, nil
}

// Ready returns a channel that is closed once Run has finished registering
// the initial watch set (canonical roots + any pre-existing sidecar tree)
// and is about to enter its event loop. Filesystem changes made before
// Ready() closes race the initial fsnotify.Watcher.Add calls and may be
// missed entirely — callers that need every change observed (tests driving
// Run in a goroutine; a caller wanting a "watching started" log line) should
// wait on Ready() before touching the filesystem. Safe to call before Run
// starts; the returned channel is the same one Run will eventually close.
func (w *Watcher) Ready() <-chan struct{} {
	return w.ready
}

// Run watches every configured root and the reviewstore sidecar tree until
// ctx is canceled. Errors adding individual watches are logged (not fatal)
// so one unreadable directory doesn't take down file-watching for the rest.
func (w *Watcher) Run(ctx context.Context) error {
	defer func() { _ = w.fsw.Close() }()

	if w.roots != nil {
		for _, root := range w.roots.List() {
			if err := w.addTree(root.Resolver.Root()); err != nil {
				slog.Warn("events: watch canonical root failed", "root", root.Name, "err", err)
			}
		}
		if base, err := reviewstore.BaseDir(); err == nil {
			for _, root := range w.roots.List() {
				sidecarRoot := filepath.Join(base, root.Name)
				// The sidecar tree for a root may not exist yet (no file has
				// been ingested); that's fine, it gets created lazily and we
				// pick it up via the parent watch's Create events walking in
				// addTree below once populated. Best-effort only.
				if _, err := os.Stat(sidecarRoot); err == nil {
					if err := w.addTree(sidecarRoot); err != nil {
						slog.Warn("events: watch sidecar root failed", "root", root.Name, "err", err)
					}
				} else if err := w.ensureWatchable(base); err != nil {
					slog.Warn("events: watch sidecar base failed", "err", err)
				}
			}
		}
	}

	close(w.ready)

	for {
		select {
		case <-ctx.Done():
			w.stopAllTimers()
			return nil
		case ev, ok := <-w.fsw.Events:
			if !ok {
				return nil
			}
			w.handleFsEvent(ev)
		case err, ok := <-w.fsw.Errors:
			if !ok {
				return nil
			}
			w.handleFsError(err)
		}
	}
}

// handleFsError logs every fsnotify error and additionally recovers from
// ErrEventOverflow: the OS-level event queue (inotify on Linux, similar
// buffering elsewhere) has a fixed capacity, and once it overflows fsnotify
// can no longer promise every individual change was reported — some file
// creates/updates/deletes may have been silently dropped. There's no way to
// know which ones, so the safe fallback is to broadcast one KindTree event
// per configured root: it costs one extra /api/dirs + /api/files re-fetch
// per client, but guarantees the client's tree view can't stay silently
// stale after an overflow.
func (w *Watcher) handleFsError(err error) {
	slog.Warn("events: fsnotify error", "err", err)
	if !errors.Is(err, fsnotify.ErrEventOverflow) {
		return
	}
	if w.roots == nil {
		return
	}
	for _, root := range w.roots.List() {
		w.hub.Broadcast(Event{Kind: KindTree, Root: root.Name})
	}
}

// ensureWatchable watches dir itself (if it exists) so a later mkdir of a
// root's sidecar subdirectory is observed and can trigger addTree.
func (w *Watcher) ensureWatchable(dir string) error {
	if _, err := os.Stat(dir); err != nil {
		return nil
	}
	return w.fsw.Add(dir)
}

// addTree walks root and registers a watch on every directory within it
// (fsnotify.Watcher.Add is non-recursive). Skips the noise directories the
// files handler also skips, since nothing under those is ever surfaced.
//
// Refuses to walk any path that isn't inside a configured REVIEW_ROOT or
// the reviewstore sidecar base — a defensive gate that ensures a stray
// fsnotify Create event with an unexpected Name can never turn into an
// unbounded filesystem traversal (issue #135: a Create event with Name=""
// or "." from the launchd cwd of "/" caused addTree to walk / and try to
// watch /Applications, /Library, /System, /Users, ... exhausting the
// process FD limit).
//
// Caveat: directories reached only via a symlink are NOT watched.
// filepath.WalkDir does not follow symlinks, so a root that contains a
// symlinked subdirectory (or is itself a symlink into another tree) will
// silently miss changes made under that symlinked path — no SSE tree/file
// event is ever broadcast for it. Content under a symlink is still reachable
// through the existing REST endpoints (files.Resolver resolves symlinks for
// individual reads), so this is a push-notification gap, not a functionality
// gap: clients relying on symlinked content only get updates via their
// polling fallback (issue #112), never via the push channel.
func (w *Watcher) addTree(root string) error {
	if !w.isWithinAllowedRoot(root) {
		slog.Warn("events: refusing to walk path outside configured roots", "path", root)
		return nil
	}
	return filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			// A directory that vanished mid-walk (race with a delete) isn't
			// fatal to the rest of the walk.
			return nil
		}
		if !d.IsDir() {
			return nil
		}
		name := d.Name()
		if name != filepath.Base(root) && strings.HasPrefix(name, ".") {
			return filepath.SkipDir
		}
		if _, skip := noiseDirs[name]; skip {
			return filepath.SkipDir
		}
		if err := w.fsw.Add(path); err != nil {
			slog.Warn("events: add watch failed", "path", path, "err", err)
		}
		return nil
	})
}

// isWithinAllowedRoot returns true when p (any path form) resolves to
// somewhere inside a configured REVIEW_ROOT canonical tree or the
// reviewstore sidecar base. Used as a hard gate around addTree so a stray
// fsnotify event with an unexpected Name can never trigger an unbounded
// walk outside the configured scope (issue #135).
func (w *Watcher) isWithinAllowedRoot(p string) bool {
	if p == "" {
		return false
	}
	abs, err := filepath.Abs(p)
	if err != nil {
		return false
	}
	abs = filepath.Clean(abs)
	for _, allowed := range w.allowedRoots() {
		if isWithinPath(allowed, abs) {
			return true
		}
	}
	return false
}

// allowedRoots enumerates every top-level path addTree is permitted to
// walk: each canonical REVIEW_ROOT (already absolute + symlink-resolved by
// files.NewResolver) plus the reviewstore sidecar base. Empty when the
// server was started without any files-API configuration.
func (w *Watcher) allowedRoots() []string {
	if w.roots == nil {
		return nil
	}
	list := w.roots.List()
	out := make([]string, 0, len(list)+1)
	for _, r := range list {
		out = append(out, filepath.Clean(r.Resolver.Root()))
	}
	if base, err := reviewstore.BaseDir(); err == nil {
		out = append(out, filepath.Clean(base))
	}
	return out
}

// isWithinPath returns true when p is root or nested inside it. Both must
// already be absolute + cleaned; anything relative is rejected.
func isWithinPath(root, p string) bool {
	rel, err := filepath.Rel(root, p)
	if err != nil {
		return false
	}
	if rel == "." {
		return true
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return false
	}
	return true
}

// noiseDirs mirrors internal/handler's noiseDirs — directories the files API
// never surfaces, so there is no point paying the fsnotify fd cost for them.
var noiseDirs = map[string]struct{}{
	"node_modules": {},
	"vendor":       {},
	"tmp":          {},
	"bin":          {},
	"dist":         {},
	"build":        {},
	"target":       {},
}

// handleFsEvent classifies a raw fsnotify event as either a canonical-file
// change, a sidecar (review.json) change, or a new directory that needs its
// own watch, then schedules a debounced broadcast.
func (w *Watcher) handleFsEvent(ev fsnotify.Event) {
	info, statErr := os.Stat(ev.Name)
	isDir := statErr == nil && info.IsDir()

	// A newly created directory must be watched immediately so subsequent
	// events inside it (including a nested mkdir) aren't missed — this is
	// what makes recursive watching work on top of fsnotify's flat Add.
	if isDir && (ev.Op&fsnotify.Create != 0) {
		if err := w.addTree(ev.Name); err != nil {
			slog.Warn("events: add watch for new dir failed", "path", ev.Name, "err", err)
		}
		return
	}
	if isDir {
		return
	}

	base := filepath.Base(ev.Name)
	switch {
	case base == reviewstore.ReviewFileName:
		w.handleSidecarEvent(ev)
	case strings.EqualFold(filepath.Ext(base), ".md"):
		w.handleCanonicalEvent(ev)
	}
}

// handleCanonicalEvent maps a canonical .md file event to its (root,
// relPath) and schedules a coalesced tree+file broadcast.
func (w *Watcher) handleCanonicalEvent(ev fsnotify.Event) {
	if w.roots == nil {
		return
	}
	for _, root := range w.roots.List() {
		rp := root.Resolver.Root()
		rel, err := filepath.Rel(rp, ev.Name)
		if err != nil || strings.HasPrefix(rel, "..") {
			continue
		}
		mtime := ""
		if info, err := os.Stat(ev.Name); err == nil {
			mtime = info.ModTime().UTC().Format(time.RFC3339)
		}
		// Best-effort: a file that vanished between the fsnotify event and
		// this read (e.g. a fast delete+recreate) just emits without a sha
		// rather than dropping the notification entirely.
		sha := ""
		if data, err := os.ReadFile(ev.Name); err == nil {
			sha = files.Sha256Hex(data)
		}
		relSlash := filepath.ToSlash(rel)
		// Both events describe the same on-disk state, so they share one
		// fingerprint — the tree event carries no sha on the wire (clients only
		// need "the listing changed") but must still be deduped by content,
		// since two same-second writes produce an identical tree payload while
		// the listing's size/order can differ (issue #176).
		fp := stateFingerprint(sha, mtime)
		w.schedule(Event{Kind: KindTree, Root: root.Name, Path: relSlash, Mtime: mtime}, fp)
		w.schedule(Event{Kind: KindFile, Root: root.Name, Path: relSlash, Mtime: mtime, Sha: sha}, fp)
		return
	}
}

// handleSidecarEvent maps a review.json change to its (root, relPath) by
// stripping the reviewstore base dir + root name prefix, then the trailing
// "review.json" segment, and schedules a coalesced comments broadcast.
func (w *Watcher) handleSidecarEvent(ev fsnotify.Event) {
	if w.roots == nil {
		return
	}
	base, err := reviewstore.BaseDir()
	if err != nil {
		return
	}
	for _, root := range w.roots.List() {
		sidecarRoot := filepath.Join(base, root.Name)
		rel, err := filepath.Rel(sidecarRoot, ev.Name)
		if err != nil || strings.HasPrefix(rel, "..") {
			continue
		}
		// rel is "<relPath>/review.json" (EntryDir joins root+relPath as a
		// directory, review.json lives inside it) — strip the filename.
		relDir := filepath.Dir(rel)
		if relDir == "." {
			continue
		}
		mtime := ""
		if info, err := os.Stat(ev.Name); err == nil {
			mtime = info.ModTime().UTC().Format(time.RFC3339)
		}
		// The comments payload has no sha on the wire, but dedup still needs a
		// content-precise fingerprint: mtime is RFC3339 (second precision), so
		// two different review.json saves inside one second would otherwise
		// look identical and the second would be dropped — leaving a client
		// whose comment polling is disabled (SSE connected) without the newer
		// comments until some unrelated event arrives.
		sha := ""
		if data, err := os.ReadFile(ev.Name); err == nil {
			sha = files.Sha256Hex(data)
		}
		w.schedule(
			Event{Kind: KindComments, Root: root.Name, Path: filepath.ToSlash(relDir), Mtime: mtime},
			stateFingerprint(sha, mtime),
		)
		return
	}
}

// schedule debounces ev by (kind, root, path): repeated events for the same
// key within debounceWindow reset the timer and keep only the latest
// payload, so a burst of writes to one file broadcasts exactly once.
//
// Debouncing alone only collapses bursts *inside* the window. fsnotify events
// that straddle it — a tool rewriting the same bytes 300ms later, a repeated
// `touch` to the same timestamp — used to produce a second broadcast for a
// state every client already had (issue #176), costing each of them a
// redundant /api/stat (kind=file) or /api/dirs + /api/files refetch
// (kind=tree). So the timer also compares fingerprint against the last state
// successfully broadcast for this key and stays silent when nothing changed.
//
// Suppression is deliberately conservative: it needs a known state
// (fingerprint != ""), a fully-delivered previous broadcast, and the same
// audience (see sentState.epoch). Anything else broadcasts, because a missed
// notification leaves a client stale while a redundant one only costs a
// refetch.
//
// fingerprint identifies the on-disk state behind ev (see stateFingerprint);
// pass "" when it couldn't be determined, which disables suppression for that
// event.
func (w *Watcher) schedule(ev Event, fingerprint string) {
	key := debounceKey(ev)

	w.mu.Lock()
	defer w.mu.Unlock()

	w.pending[key] = pendingEvent{ev: ev, fingerprint: fingerprint}
	if t, ok := w.timers[key]; ok {
		t.Stop()
	}
	w.timers[key] = time.AfterFunc(debounceWindow, func() {
		// Read the epoch before broadcasting: a client that subscribes while
		// this event is in flight must not be counted as having received it,
		// and recording the older epoch is what makes the next identical event
		// go out for them.
		epoch := w.hub.SubscriberEpoch()

		w.mu.Lock()
		p, ok := w.pending[key]
		delete(w.pending, key)
		delete(w.timers, key)
		prev, remembered := w.lastSent[key]
		suppress := ok && remembered &&
			p.fingerprint != "" &&
			prev.fingerprint == p.fingerprint &&
			prev.epoch == epoch
		w.mu.Unlock()
		if !ok || suppress {
			return
		}

		delivered := w.hub.Broadcast(p.ev)

		w.mu.Lock()
		defer w.mu.Unlock()
		if !delivered || p.fingerprint == "" {
			// A subscriber whose buffer was full didn't get this event. Never
			// remember such a state: that client's polling is disabled while
			// SSE is connected, so suppressing the identical follow-up (the
			// only thing that could still repair it) would leave it stale
			// indefinitely. Drop any older memo too, for the same reason.
			delete(w.lastSent, key)
			return
		}
		if len(w.lastSent) >= maxRememberedEvents {
			w.lastSent = make(map[string]sentState)
		}
		w.lastSent[key] = sentState{fingerprint: p.fingerprint, epoch: epoch}
	})
}

// debounceKey identifies the stream of events about one thing: a kind + root +
// path triple.
//
// The separator is NUL, which cannot appear in a filesystem path, so no
// combination of root name and relative path can produce the same key as a
// different combination — with a printable separator, root "a" + path "b|c.md"
// and a root literally named "a|b" + path "c.md" would collide and the two
// files would share one debounce timer and one suppression memo, silently
// swallowing an event for the wrong file.
func debounceKey(ev Event) string {
	return string(ev.Kind) + "\x00" + ev.Root + "\x00" + ev.Path
}

// stateFingerprint builds the dedup key for the on-disk state an event
// describes: the content hash plus the mtime it was observed with.
//
// Both parts are required. sha alone would suppress a `touch` (same bytes, new
// mtime), which clients need in order to acknowledge the new mtime; mtime
// alone is RFC3339 second precision, so two different writes landing in one
// second would look identical. An empty result means "unknown state" — the
// emitter couldn't stat or read the file (removed or unreadable between the
// fsnotify event and the read) — and disables suppression, because missing a
// notification leaves a client stale while a redundant one only costs a
// refetch.
//
// Events that never go through schedule (the ErrEventOverflow fallback in
// handleFsError) are unaffected and always delivered.
func stateFingerprint(sha, mtime string) string {
	if sha == "" || mtime == "" {
		return ""
	}
	return sha + "|" + mtime
}

// stopAllTimers cancels any in-flight debounce timers on shutdown so no
// broadcast fires after Run has returned.
func (w *Watcher) stopAllTimers() {
	w.mu.Lock()
	defer w.mu.Unlock()
	for key, t := range w.timers {
		t.Stop()
		delete(w.timers, key)
		delete(w.pending, key)
	}
}
