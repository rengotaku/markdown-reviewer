package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"markdown-reviewer/internal/reviewstore"
)

func TestCmdDiff_SinceLastRead(t *testing.T) {
	root := withRoots(t)
	t.Setenv("REVIEWER_CONFIG_DIR", t.TempDir())
	body := "line one.\nline two.\n"
	rel := setupDoc(t, root, body)

	newBody := "line one.\nline TWO changed.\nline three.\n"
	if err := os.WriteFile(filepath.Join(root, rel), []byte(newBody), 0o644); err != nil {
		t.Fatal(err)
	}

	out, err := captureStdout(t, func() error { return cmdDiff([]string{filepath.Join(root, rel)}) })
	if err != nil {
		t.Fatalf("cmdDiff: %v", err)
	}
	if !strings.Contains(out, "-line two.") || !strings.Contains(out, "+line TWO changed.") {
		t.Errorf("diff output missing expected hunk: %q", out)
	}
}

func TestCmdDiff_SinceExplicitRevision(t *testing.T) {
	root := withRoots(t)
	t.Setenv("REVIEWER_CONFIG_DIR", t.TempDir())
	p := filepath.Join(root, "note.md")
	if err := os.WriteFile(p, []byte("v0"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := reviewstore.Ingest("works", "note.md"); err != nil {
		t.Fatalf("Ingest: %v", err)
	}
	rev0, _, err := reviewstore.AppendRevision("works", "note.md", "human", "v0")
	if err != nil {
		t.Fatalf("AppendRevision v0: %v", err)
	}
	if _, _, aErr := reviewstore.AppendRevision("works", "note.md", "ai", "v1"); aErr != nil {
		t.Fatalf("AppendRevision v1: %v", aErr)
	}
	if wErr := os.WriteFile(p, []byte("v2"), 0o644); wErr != nil {
		t.Fatal(wErr)
	}

	out, err := captureStdout(t, func() error { return cmdDiff([]string{p, "--since", rev0.ID}) })
	if err != nil {
		t.Fatalf("cmdDiff: %v", err)
	}
	if !strings.Contains(out, "-v0") || !strings.Contains(out, "+v2") {
		t.Errorf("diff against explicit revision missing hunk: %q", out)
	}
}

func TestCmdDiff_NoDifference(t *testing.T) {
	root := withRoots(t)
	t.Setenv("REVIEWER_CONFIG_DIR", t.TempDir())
	body := "unchanged\n"
	rel := setupDoc(t, root, body)

	out, err := captureStdout(t, func() error { return cmdDiff([]string{filepath.Join(root, rel)}) })
	if err != nil {
		t.Fatalf("cmdDiff: %v", err)
	}
	if strings.TrimSpace(out) != "差分はありません。" {
		t.Errorf("output = %q, want 差分はありません。", out)
	}
}

func TestCmdDiff_NoLastRead_Errors(t *testing.T) {
	root := withRoots(t)
	t.Setenv("REVIEWER_CONFIG_DIR", t.TempDir())
	p := filepath.Join(root, "note.md")
	if err := os.WriteFile(p, []byte("v0"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := reviewstore.Ingest("works", "note.md"); err != nil {
		t.Fatalf("Ingest: %v", err)
	}
	// No last_read recorded yet.
	if err := cmdDiff([]string{p}); err == nil {
		t.Fatal("cmdDiff succeeded with no last_read recorded")
	}
}

func TestCmdDiff_UnknownRevision_Errors(t *testing.T) {
	root := withRoots(t)
	t.Setenv("REVIEWER_CONFIG_DIR", t.TempDir())
	rel := setupDoc(t, root, "v0")

	err := cmdDiff([]string{filepath.Join(root, rel), "--since", "r-999"})
	if err == nil {
		t.Fatal("cmdDiff succeeded for an unknown revision id")
	}
	if !strings.Contains(err.Error(), "r-999") {
		t.Errorf("error %q does not name the missing id", err)
	}
}
