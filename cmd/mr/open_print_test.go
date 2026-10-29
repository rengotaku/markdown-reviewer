package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// slotServer fakes the server's ad-hoc endpoints. holds is the file the slot
// currently holds ("" = empty). POST /api/adhoc is counted and, on success,
// swaps the slot to the posted file the way the real handler does.
func slotServer(t *testing.T, holds string) (base string, posts *int) {
	t.Helper()
	count := 0
	current := holds
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/adhoc" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if r.Method == http.MethodPost {
			count++
			var req struct {
				Path string `json:"path"`
			}
			_ = json.NewDecoder(r.Body).Decode(&req)
			current = req.Path
		}
		if current == "" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"root": "anonymous", "dir": filepath.Dir(current), "path": filepath.Base(current), "ephemeral": true,
		})
	}))
	t.Cleanup(srv.Close)
	return srv.URL, &count
}

func TestCmdOpenPrint_SameFileInSlotDoesNotRegister(t *testing.T) {
	withRoots(t)
	file := outOfRootFile(t, "same.md")
	base, posts := slotServer(t, file)
	t.Setenv(baseURLEnv, base)

	out, err := captureStdout(t, func() error { return cmdOpen([]string{file, "--print"}) })
	if err != nil {
		t.Fatalf("cmdOpen: %v", err)
	}
	if *posts != 0 {
		t.Errorf("POST /api/adhoc count = %d, want 0", *posts)
	}
	want := base + "/anonymous/same.md"
	if strings.TrimSpace(out) != want {
		t.Errorf("stdout = %q, want %q", strings.TrimSpace(out), want)
	}
}

func TestCmdOpenPrint_OtherFileInSlotErrorsWithoutRegistering(t *testing.T) {
	withRoots(t)
	held := outOfRootFile(t, "held.md")
	target := outOfRootFile(t, "target.md")
	base, posts := slotServer(t, held)
	t.Setenv(baseURLEnv, base)

	out, err := captureStdout(t, func() error { return cmdOpen([]string{target, "--print"}) })
	if err == nil {
		t.Fatal("cmdOpen succeeded, want an error")
	}
	if *posts != 0 {
		t.Errorf("POST /api/adhoc count = %d, want 0", *posts)
	}
	for _, want := range []string{held, "--replace-slot", "--print"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error %q lacks %q", err, want)
		}
	}
	if strings.TrimSpace(out) != "" {
		t.Errorf("stdout = %q, want empty", out)
	}
}

func TestCmdOpenPrint_EmptySlotErrorsWithoutRegistering(t *testing.T) {
	withRoots(t)
	target := outOfRootFile(t, "target.md")
	base, posts := slotServer(t, "")
	t.Setenv(baseURLEnv, base)

	_, err := captureStdout(t, func() error { return cmdOpen([]string{target, "--print"}) })
	if err == nil {
		t.Fatal("cmdOpen succeeded, want an error")
	}
	if *posts != 0 {
		t.Errorf("POST /api/adhoc count = %d, want 0", *posts)
	}
	if !strings.Contains(err.Error(), "empty") || !strings.Contains(err.Error(), "--replace-slot") {
		t.Errorf("error %q should say the slot is empty and mention --replace-slot", err)
	}
}

func TestCmdOpenPrint_ReplaceSlotRegisters(t *testing.T) {
	withRoots(t)
	held := outOfRootFile(t, "held.md")
	target := outOfRootFile(t, "target.md")
	base, posts := slotServer(t, held)
	t.Setenv(baseURLEnv, base)

	out, err := captureStdout(t, func() error { return cmdOpen([]string{target, "--print", "--replace-slot"}) })
	if err != nil {
		t.Fatalf("cmdOpen: %v", err)
	}
	if *posts != 1 {
		t.Errorf("POST /api/adhoc count = %d, want 1", *posts)
	}
	if want := base + "/anonymous/target.md"; strings.TrimSpace(out) != want {
		t.Errorf("stdout = %q, want %q", strings.TrimSpace(out), want)
	}
}

func TestCmdOpenPrint_InRootFileNeverTouchesSlot(t *testing.T) {
	root := withRoots(t)
	p := filepath.Join(root, "in.md")
	if err := os.WriteFile(p, []byte("# x\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	base, posts := slotServer(t, "")
	t.Setenv(baseURLEnv, base)
	if _, err := captureStdout(t, func() error { return cmdOpen([]string{p, "--print"}) }); err != nil {
		t.Fatalf("cmdOpen: %v", err)
	}
	if *posts != 0 {
		t.Errorf("POST count = %d, want 0", *posts)
	}
}

func TestCmdOpenWithoutPrint_StillRegisters(t *testing.T) {
	withRoots(t)
	held := outOfRootFile(t, "held.md")
	target := outOfRootFile(t, "target.md")
	base, posts := slotServer(t, held)
	t.Setenv(baseURLEnv, base)
	// Without --print cmdOpen launches a browser. An empty PATH makes that
	// launch fail (nothing is executed); registration happens before it.
	t.Setenv("PATH", t.TempDir())
	out, err := captureStdout(t, func() error { return cmdOpen([]string{target}) })
	if err == nil || !strings.Contains(err.Error(), "launching the browser") {
		t.Fatalf("cmdOpen error = %v, want the browser-launch failure", err)
	}
	if want := base + "/anonymous/target.md"; strings.TrimSpace(out) != want {
		t.Errorf("stdout = %q, want %q", strings.TrimSpace(out), want)
	}
	if *posts != 1 {
		t.Errorf("POST /api/adhoc count = %d, want 1 (no --print keeps registering)", *posts)
	}
}
