// Package events implements the server-push side of issue #112: a small
// pub/sub hub that fans filesystem-change notifications out to every
// connected SSE client (GET /api/events), plus a fsnotify-backed Watcher
// (watcher.go) that feeds it.
//
// Events are intentionally metadata-only (kind/root/path/mtime) — the
// payload itself is never pushed. Clients re-fetch the affected resource
// through the existing REST endpoints (/api/dirs, /api/files, /api/stat,
// /api/comments) once notified, keeping this package free of any of the
// file-content or review-state business logic that already lives elsewhere.
package events

import (
	"encoding/json"
	"sync"
)

// Kind identifies what changed. Kept as a small closed set so clients can
// switch on it without parsing anything else.
type Kind string

const (
	// KindTree signals the directory/file listing changed (create, delete,
	// or rename of a canonical file) — the client should invalidate the
	// "dirs"/"files" react-query caches.
	KindTree Kind = "tree"
	// KindFile signals the canonical content of Root+Path changed on disk.
	// The client compares Root+Path against its currently active file and,
	// on a match, runs the same external-edit flow useFileWatcher used to
	// poll for.
	KindFile Kind = "file"
	// KindComments signals the sidecar review.json for Root+Path changed —
	// the client should re-fetch comments (and the stat-derived tab badge)
	// for that file when it matches the active one.
	KindComments Kind = "comments"
)

// Event is the JSON payload of one SSE `data:` line. Fields are the minimum
// needed for the client to decide what to re-fetch; Mtime is RFC3339 (UTC)
// and empty when not applicable (e.g. a delete). Sha is the sha256 hex
// digest of the file's current bytes, populated on KindFile events only
// (best-effort: omitted if the file couldn't be read at emit time) — mtime
// alone (second precision) can't detect a same-second double-save, but the
// content hash always can (issue #119).
type Event struct {
	Kind  Kind   `json:"kind"`
	Root  string `json:"root"`
	Path  string `json:"path"`
	Mtime string `json:"mtime,omitempty"`
	Sha   string `json:"sha,omitempty"`
}

// subscriberBuffer bounds how many pending events a slow client can
// accumulate before the hub gives up on it. Coalescing in the watcher keeps
// steady-state traffic low, so a generous buffer is cheap insurance against
// a single burst (e.g. many files touched at once) disconnecting a client.
const subscriberBuffer = 64

// Hub tracks connected SSE subscribers and fans events out to all of them.
// The zero value is not usable; use NewHub.
type Hub struct {
	subs map[chan Event]struct{}
	mu   sync.Mutex
}

// NewHub creates an empty Hub ready to accept subscribers.
func NewHub() *Hub {
	return &Hub{subs: make(map[chan Event]struct{})}
}

// Subscribe registers a new client and returns its event channel plus an
// unsubscribe func the caller must invoke exactly once (typically via
// defer) when the connection ends. The returned channel is closed by
// Unsubscribe, never by a send, so callers can safely range over it.
func (h *Hub) Subscribe() (<-chan Event, func()) {
	ch := make(chan Event, subscriberBuffer)
	h.mu.Lock()
	h.subs[ch] = struct{}{}
	h.mu.Unlock()

	unsubscribe := func() {
		h.mu.Lock()
		if _, ok := h.subs[ch]; ok {
			delete(h.subs, ch)
			close(ch)
		}
		h.mu.Unlock()
	}
	return ch, unsubscribe
}

// Broadcast fans ev out to every currently-subscribed channel. A slow
// subscriber whose buffer is full has the event dropped for it rather than
// blocking every other subscriber (and the watcher goroutine) — SSE events
// here are a "something changed, go re-fetch" hint, so an occasional missed
// notification is harmless as long as the next one arrives.
func (h *Hub) Broadcast(ev Event) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs {
		select {
		case ch <- ev:
		default:
			// Drop for this slow subscriber; don't block the others.
		}
	}
}

// SubscriberCount reports how many clients are currently connected. Used by
// tests and available for future health/debug surfacing.
func (h *Hub) SubscriberCount() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.subs)
}

// Marshal is a small helper so handler code doesn't need to import
// encoding/json itself just to serialize an Event for the SSE `data:` line.
func (e Event) Marshal() ([]byte, error) {
	return json.Marshal(e)
}
