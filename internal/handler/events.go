package handler

import (
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// heartbeatInterval is how often a `:keep-alive` SSE comment line is sent on
// an otherwise-idle connection. This keeps intermediate proxies / load
// balancers from timing out the long-lived request and gives the client a
// cheap signal the connection is still alive.
const heartbeatInterval = 20 * time.Second

// Events streams GET /api/events as text/event-stream: one `data:` line per
// events.Event (JSON-encoded), or a `:keep-alive` comment line when nothing
// happened for heartbeatInterval. The connection stays open until the
// client disconnects (browser tab close, EventSource.close(), or the
// underlying TCP connection dropping) — signaled via the request context.
func (h *Handler) Events(c *gin.Context) {
	if h.hub == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "events hub not configured"})
		return
	}

	// Block until the watcher's initial fsnotify registration has finished
	// (or the client disconnects) before writing any response bytes. Without
	// this gate, EventSource's `onopen` — and the frontend's decision to stop
	// polling — can fire the instant the HTTP handshake completes, racing the
	// watcher's own startup; a filesystem change made in that window would
	// never be observed as a push event (issue #119, case 3). h.ready is nil
	// whenever no watcher was wired via SetWatcherReady, in which case this
	// is a no-op and streaming starts immediately as before.
	if h.ready != nil {
		select {
		case <-h.ready:
		case <-c.Request.Context().Done():
			return
		}
	}

	ch, unsubscribe := h.hub.Subscribe()
	defer unsubscribe()

	// The server's http.Server sets a blanket WriteTimeout (server.go) so a
	// misbehaving handler can't hold a connection open forever. SSE is the
	// deliberate exception: this connection is *meant* to stay open for the
	// life of the client, so its write deadline must be disabled or the
	// underlying net.Conn gets forcibly closed mid-stream (well before the
	// heartbeat ticker below ever fires) and the browser sees a dropped
	// connection every WriteTimeout interval. http.ResponseController (Go
	// 1.20+) is the documented way to reach the per-connection deadline
	// through gin's ResponseWriter wrapper (gin's type implements Unwrap()
	// http.ResponseWriter, which ResponseController follows). A failure here
	// is logged, not fatal — the stream still works, just re-subject to the
	// server's WriteTimeout on this connection.
	rc := http.NewResponseController(c.Writer)
	if err := rc.SetWriteDeadline(time.Time{}); err != nil {
		slog.Warn("events: could not disable write deadline for SSE connection", "err", err)
	}

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	// Nginx-style reverse proxies buffer responses by default, which would
	// defeat SSE's whole point (the client never sees data until the buffer
	// fills or the connection closes). This header is the documented opt-out.
	c.Header("X-Accel-Buffering", "no")

	ctx := c.Request.Context()
	ticker := time.NewTicker(heartbeatInterval)
	defer ticker.Stop()

	c.Status(http.StatusOK)
	c.Writer.Flush()

	for {
		select {
		case <-ctx.Done():
			return
		case ev, ok := <-ch:
			if !ok {
				return
			}
			payload, err := ev.Marshal()
			if err != nil {
				continue
			}
			_, _ = fmt.Fprintf(c.Writer, "data: %s\n\n", payload)
			c.Writer.Flush()
		case <-ticker.C:
			_, _ = fmt.Fprint(c.Writer, ":keep-alive\n\n")
			c.Writer.Flush()
		}
	}
}
