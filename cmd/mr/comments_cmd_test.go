package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"markdown-reviewer/internal/reviewstore"
)

// TestCmdComments_StampsLastReadAndPrintsBanner drives cmdComments end to
// end: the first call has nothing to compare against and stamps last_read;
// an edit lands on disk; the second call must print the drift banner above
// its normal comment listing and stamp a fresh last_read matching the new
// body.
func TestCmdComments_StampsLastReadAndPrintsBanner(t *testing.T) {
	root := withRoots(t)
	t.Setenv("REVIEWER_CONFIG_DIR", t.TempDir())
	rel := "doc.md"
	p := filepath.Join(root, rel)
	body := "# Title\n\noriginal\n"
	if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := reviewstore.Ingest("works", rel); err != nil {
		t.Fatalf("Ingest: %v", err)
	}

	out, err := captureStdout(t, func() error { return cmdComments([]string{p}) })
	if err != nil {
		t.Fatalf("cmdComments (first read): %v", err)
	}
	if strings.Contains(out, "本文が変わっています") {
		t.Errorf("first read must not print a banner (nothing to compare against): %q", out)
	}
	firstLastRead, ok, err := reviewstore.ReadLastRead("works", rel)
	if err != nil || !ok {
		t.Fatalf("ReadLastRead after first cmdComments: ok=%v err=%v", ok, err)
	}
	if firstLastRead.Sha != reviewstore.ShortSha(body) {
		t.Errorf("last_read.Sha = %q, want the sha of the body just read", firstLastRead.Sha)
	}

	newBody := "# Title\n\nedited externally\n"
	if wErr := os.WriteFile(p, []byte(newBody), 0o644); wErr != nil {
		t.Fatal(wErr)
	}

	out, err = captureStdout(t, func() error { return cmdComments([]string{p}) })
	if err != nil {
		t.Fatalf("cmdComments (second read): %v", err)
	}
	if !strings.Contains(out, "本文が変わっています") {
		t.Errorf("second read (body drifted) must print the banner: %q", out)
	}

	secondLastRead, ok, err := reviewstore.ReadLastRead("works", rel)
	if err != nil || !ok {
		t.Fatalf("ReadLastRead after second cmdComments: ok=%v err=%v", ok, err)
	}
	if secondLastRead.Sha != reviewstore.ShortSha(newBody) {
		t.Errorf("last_read.Sha after second read = %q, want the sha of newBody", secondLastRead.Sha)
	}

	out, err = captureStdout(t, func() error { return cmdComments([]string{p}) })
	if err != nil {
		t.Fatalf("cmdComments (third read, unchanged): %v", err)
	}
	if strings.Contains(out, "本文が変わっています") {
		t.Errorf("third read (body unchanged since second) must not print a banner: %q", out)
	}
}

// TestCmdComments_JSON_BannerGoesToStderr keeps stdout parseable JSON even
// when a drift banner fires.
func TestCmdComments_JSON_BannerGoesToStderr(t *testing.T) {
	root := withRoots(t)
	t.Setenv("REVIEWER_CONFIG_DIR", t.TempDir())
	body := "v0\n"
	rel := setupDoc(t, root, body)
	if err := os.WriteFile(filepath.Join(root, rel), []byte("v1\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	stdout, err := captureStdout(t, func() error { return cmdComments([]string{filepath.Join(root, rel), "--json"}) })
	if err != nil {
		t.Fatalf("cmdComments --json: %v", err)
	}
	if strings.Contains(stdout, "本文が変わっています") {
		t.Errorf("banner leaked into --json stdout: %q", stdout)
	}
	if !strings.HasPrefix(strings.TrimSpace(stdout), "[") {
		t.Errorf("stdout is not JSON: %q", stdout)
	}
}
