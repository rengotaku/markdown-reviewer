package server_test

import (
	"context"
	"reflect"
	"testing"
	"time"

	"markdown-reviewer/internal/server"
	"markdown-reviewer/internal/serverdefaults"
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

// TestConfigPortDefaultMatchesServerDefaults guards the one duplication the
// mr CLI needs: it builds web UI URLs from serverdefaults.Port when no PORT
// and no launchd plist tell it otherwise, so that constant must stay equal to
// the default this Config actually applies. A struct tag can't reference a
// constant, hence the assertion here rather than a shared literal.
func TestConfigPortDefaultMatchesServerDefaults(t *testing.T) {
	field, ok := reflect.TypeOf(server.Config{}).FieldByName("Port")
	if !ok {
		t.Fatal("server.Config has no Port field")
	}
	want := "PORT,default=" + serverdefaults.Port
	if got := field.Tag.Get("env"); got != want {
		t.Errorf("Config.Port env tag = %q, want %q (update internal/serverdefaults together with the tag)", got, want)
	}
}
