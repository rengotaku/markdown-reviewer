package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"markdown-reviewer/internal/files"
)

// adhocServer stands in for the running reviewer: GET /api/adhoc answers with
// the slot's occupant, or 404 when reply is empty. It also records whether a
// POST arrived, so a test can prove a read-back never re-registers.
func adhocServer(t *testing.T, reply string) (base string, posted *bool) {
	t.Helper()
	sawPost := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/adhoc" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if r.Method == http.MethodPost {
			sawPost = true
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if reply == "" {
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":"no one-off review is registered"}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(reply))
	}))
	t.Cleanup(srv.Close)
	return srv.URL, &sawPost
}

// outOfRootFile writes a .md outside every configured root and returns its
// symlink-resolved absolute path.
func outOfRootFile(t *testing.T, name string) string {
	t.Helper()
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, []byte("# draft"), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

// withRoots points the CLI's root resolution at a single throwaway root.
func withRoots(t *testing.T) string {
	t.Helper()
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("REVIEW_ROOTS", `[{"name":"works","path":`+quoteJSON(dir)+`}]`)
	return dir
}

func quoteJSON(s string) string { return `"` + strings.ReplaceAll(s, `"`, `\"`) + `"` }

func TestResolveRegistered_ConfiguredRootStillWins(t *testing.T) {
	root := withRoots(t)
	p := filepath.Join(root, "note.md")
	if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	// No server: a file inside a root must resolve without touching it.
	t.Setenv(baseURLEnv, "http://127.0.0.1:1")

	gotRoot, rel, abs, err := resolveRegistered(p)
	if err != nil {
		t.Fatalf("resolveRegistered() error = %v", err)
	}
	if gotRoot != "works" || rel != "note.md" || abs != p {
		t.Errorf("resolveRegistered() = (%q, %q, %q)", gotRoot, rel, abs)
	}
}

func TestResolveRegistered_ReachesTheRegisteredAdhocFile(t *testing.T) {
	withRoots(t)
	outside := outOfRootFile(t, "draft.md")
	base, posted := adhocServer(t, `{"root":"anonymous","dir":`+quoteJSON(filepath.Dir(outside))+`,"path":"draft.md","ephemeral":true}`)
	t.Setenv(baseURLEnv, base)

	gotRoot, rel, abs, err := resolveRegistered(outside)
	if err != nil {
		t.Fatalf("resolveRegistered() error = %v", err)
	}
	if gotRoot != files.AdhocRootName || rel != "draft.md" || abs != outside {
		t.Errorf("resolveRegistered() = (%q, %q, %q)", gotRoot, rel, abs)
	}
	if *posted {
		t.Error("resolveRegistered() re-registered the slot; reading must never wipe another file's review")
	}
}

func TestResolveRegistered_UnregisteredFileSaysRunOpen(t *testing.T) {
	withRoots(t)
	outside := outOfRootFile(t, "draft.md")
	base, posted := adhocServer(t, "")
	t.Setenv(baseURLEnv, base)

	_, _, _, err := resolveRegistered(outside)
	if err == nil {
		t.Fatal("resolveRegistered() succeeded for an unregistered out-of-root file")
	}
	if !strings.Contains(err.Error(), "mr open") {
		t.Errorf("error %q does not point at `mr open`", err)
	}
	if *posted {
		t.Error("resolveRegistered() registered the file itself; that is `mr open`'s job")
	}
}

// The slot holding a different file is the case where a silent re-register
// would destroy a review, so the error has to name what is parked there.
func TestResolveRegistered_OtherFileInSlotIsReported(t *testing.T) {
	withRoots(t)
	outside := outOfRootFile(t, "draft.md")
	other := outOfRootFile(t, "other.md")
	base, _ := adhocServer(t, `{"root":"anonymous","dir":`+quoteJSON(filepath.Dir(other))+`,"path":"other.md","ephemeral":true}`)
	t.Setenv(baseURLEnv, base)

	_, _, _, err := resolveRegistered(outside)
	if err == nil {
		t.Fatal("resolveRegistered() succeeded for a file the slot does not hold")
	}
	if !strings.Contains(err.Error(), other) {
		t.Errorf("error %q does not name the file the slot holds (%s)", err, other)
	}
}

func TestResolveRegistered_ServerDownKeepsTheRootError(t *testing.T) {
	withRoots(t)
	outside := outOfRootFile(t, "draft.md")
	t.Setenv(baseURLEnv, "http://127.0.0.1:1")

	_, _, _, err := resolveRegistered(outside)
	if err == nil {
		t.Fatal("resolveRegistered() succeeded with no server running")
	}
	if !strings.Contains(err.Error(), "not under any configured root") {
		t.Errorf("error %q lost the original root mismatch", err)
	}
}
