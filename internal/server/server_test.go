package server_test

import (
	"context"
	"testing"
	"time"

	"markdown-reviewer/internal/server"
)

// TestRun_ShutsDownOnCtxCancel exercises the contract that Run(ctx) returns
// nil after ctx is canceled and the HTTP server has drained.
//
// PORT=0 lets the kernel pick an unused port so parallel test runs and busy
// CI hosts don't fight over :8080. DATABASE_DSN=:memory: avoids leaving an
// app.db file in the working directory.
func TestRun_ShutsDownOnCtxCancel(t *testing.T) {
	t.Setenv("PORT", "0")
	t.Setenv("DATABASE_DSN", ":memory:")
	t.Setenv("SHUTDOWN_TIMEOUT", "2s")

	ctx, cancel := context.WithCancel(context.Background())

	errCh := make(chan error, 1)
	go func() {
		errCh <- server.Run(ctx)
	}()

	// Give the listener a moment to come up before signaling shutdown.
	// Without this, Shutdown() can race with ListenAndServe()'s setup.
	time.Sleep(200 * time.Millisecond)

	cancel()

	select {
	case err := <-errCh:
		if err != nil {
			t.Fatalf("Run() returned error after ctx cancel: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Run() did not return within 5s after ctx cancel")
	}
}
