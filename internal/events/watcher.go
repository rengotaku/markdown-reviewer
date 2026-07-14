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
	pending map[string]Event

	mu sync.Mutex
}

// NewWatcher creates a Watcher for the given roots, broadcasting through
// hub. Call Run to start watching; Run blocks until ctx is canceled.
func NewWatcher(hub *Hub, roots *files.Roots) (*Watcher, error) {
	fsw, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	return &Watcher{
		hub:     hub,
		roots:   roots,
		fsw:     fsw,
		ready:   make(chan struct{}),
		timers:  make(map[string]*time.Timer),
		pending: make(map[string]Event),
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
		relSlash := filepath.ToSlash(rel)
		w.schedule(Event{Kind: KindTree, Root: root.Name, Path: relSlash, Mtime: mtime})
		w.schedule(Event{Kind: KindFile, Root: root.Name, Path: relSlash, Mtime: mtime})
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
		w.schedule(Event{Kind: KindComments, Root: root.Name, Path: filepath.ToSlash(relDir), Mtime: mtime})
		return
	}
}

// schedule debounces ev by (kind, root, path): repeated events for the same
// key within debounceWindow reset the timer and keep only the latest
// payload, so a burst of writes to one file broadcasts exactly once.
func (w *Watcher) schedule(ev Event) {
	key := string(ev.Kind) + "|" + ev.Root + "|" + ev.Path

	w.mu.Lock()
	defer w.mu.Unlock()

	w.pending[key] = ev
	if t, ok := w.timers[key]; ok {
		t.Stop()
	}
	w.timers[key] = time.AfterFunc(debounceWindow, func() {
		w.mu.Lock()
		out, ok := w.pending[key]
		delete(w.pending, key)
		delete(w.timers, key)
		w.mu.Unlock()
		if ok {
			w.hub.Broadcast(out)
		}
	})
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
