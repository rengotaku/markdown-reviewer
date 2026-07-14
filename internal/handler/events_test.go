package handler_test

import (
	"bufio"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"markdown-reviewer/internal/events"
	"markdown-reviewer/internal/handler"
	"markdown-reviewer/internal/repository"
	"markdown-reviewer/internal/service"
	"markdown-reviewer/internal/testutil"
)

func TestEvents_NoHub_Returns500(t *testing.T) {
	t.Parallel()
	h := setupTestHandler(t)

	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/events", nil))
	assert.Equal(t, http.StatusInternalServerError, rec.Code)
}

func TestEvents_StreamsBroadcastAsSSE(t *testing.T) {
	t.Parallel()
	repo := repository.NewUserRepository(testutil.NewTestDB(t))
	svc := service.NewUserService(repo)
	hub := events.NewHub()
	h := handler.NewHandler(svc, nil, hub)

	// httptest.NewServer is required (rather than the ResponseRecorder
	// `serve` helper used elsewhere) because a ResponseRecorder never
	// unblocks a streaming handler — it just accumulates in a buffer. A real
	// listener lets the client read the stream while the handler is still
	// writing, matching how a browser's EventSource actually consumes it.
	srv := httptest.NewServer(h.Routes(http.NotFoundHandler()))
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, srv.URL+"/api/events", nil)
	require.NoError(t, err)

	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()

	require.Equal(t, http.StatusOK, resp.StatusCode)
	assert.Equal(t, "text/event-stream", resp.Header.Get("Content-Type"))

	// Wait for the subscriber to actually register before broadcasting —
	// otherwise the event could fire before the handler's hub.Subscribe()
	// call runs and would never be delivered.
	require.Eventually(t, func() bool { return hub.SubscriberCount() == 1 }, 2*time.Second, 10*time.Millisecond)

	hub.Broadcast(events.Event{Kind: events.KindFile, Root: "works", Path: "a.md", Mtime: "2026-05-20T00:00:00Z"})

	reader := bufio.NewReader(resp.Body)
	var dataLine string
	for {
		line, rerr := reader.ReadString('\n')
		if rerr != nil {
			t.Fatalf("stream ended before a data line arrived: %v", rerr)
		}
		if strings.HasPrefix(line, "data: ") {
			dataLine = strings.TrimSpace(strings.TrimPrefix(line, "data: "))
			break
		}
	}
	assert.JSONEq(t, `{"kind":"file","root":"works","path":"a.md","mtime":"2026-05-20T00:00:00Z"}`, dataLine)
}

// TestEvents_SurvivesServerWriteTimeout is a regression test for the
// WriteTimeout / SSE interaction: http.Server.WriteTimeout imposes a
// deadline on the underlying net.Conn's writes, which — unless explicitly
// disabled per-connection — fires in the middle of a long-lived SSE stream
// and kills it well before the handler's own heartbeat ticker ever runs.
// The production server (server.go) sets WriteTimeout: 10s; here we use a
// much shorter 1s timeout so the test doesn't have to wait 10+ seconds to
// prove the connection survives past it.
func TestEvents_SurvivesServerWriteTimeout(t *testing.T) {
	t.Parallel()
	repo := repository.NewUserRepository(testutil.NewTestDB(t))
	svc := service.NewUserService(repo)
	hub := events.NewHub()
	h := handler.NewHandler(svc, nil, hub)

	// httptest.NewUnstartedServer (rather than NewServer) so the test can
	// set Config.WriteTimeout before the listener starts accepting — this
	// mirrors internal/server.Run's http.Server{WriteTimeout: ...} setup.
	srv := httptest.NewUnstartedServer(h.Routes(http.NotFoundHandler()))
	srv.Config.WriteTimeout = 1 * time.Second
	srv.Start()
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, srv.URL+"/api/events", nil)
	require.NoError(t, err)

	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()

	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Eventually(t, func() bool { return hub.SubscriberCount() == 1 }, 2*time.Second, 10*time.Millisecond)

	// Broadcast well past WriteTimeout (1s): if the handler didn't disable
	// the per-connection write deadline, the net.Conn would already be
	// closed by the server's WriteTimeout enforcement by the time this
	// write happens, and the read below would see EOF instead of the event.
	time.Sleep(1500 * time.Millisecond)
	hub.Broadcast(events.Event{Kind: events.KindFile, Root: "works", Path: "late.md", Mtime: "2026-05-20T00:00:00Z"})

	reader := bufio.NewReader(resp.Body)
	var dataLine string
	for {
		line, rerr := reader.ReadString('\n')
		if rerr != nil {
			t.Fatalf("stream ended before the post-WriteTimeout event arrived (WriteTimeout likely killed the connection): %v", rerr)
		}
		if strings.HasPrefix(line, "data: ") {
			dataLine = strings.TrimSpace(strings.TrimPrefix(line, "data: "))
			break
		}
	}
	assert.JSONEq(t, `{"kind":"file","root":"works","path":"late.md","mtime":"2026-05-20T00:00:00Z"}`, dataLine)
}

func TestEvents_UnsubscribesOnClientDisconnect(t *testing.T) {
	t.Parallel()
	repo := repository.NewUserRepository(testutil.NewTestDB(t))
	svc := service.NewUserService(repo)
	hub := events.NewHub()
	h := handler.NewHandler(svc, nil, hub)

	srv := httptest.NewServer(h.Routes(http.NotFoundHandler()))
	defer srv.Close()

	ctx, cancel := context.WithCancel(context.Background())
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, srv.URL+"/api/events", nil)
	require.NoError(t, err)

	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)

	require.Eventually(t, func() bool { return hub.SubscriberCount() == 1 }, 2*time.Second, 10*time.Millisecond)

	// Simulate the browser tab closing / EventSource.close(): cancel the
	// request context and close the body.
	cancel()
	_ = resp.Body.Close()

	require.Eventually(t, func() bool { return hub.SubscriberCount() == 0 }, 2*time.Second, 10*time.Millisecond)
}
