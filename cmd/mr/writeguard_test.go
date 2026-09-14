package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"markdown-reviewer/internal/reviewstore"
)

func TestCheckWriteGuard_NoLastRead_Allows(t *testing.T) {
	root := withRoots(t)
	t.Setenv("REVIEWER_CONFIG_DIR", t.TempDir())
	p := filepath.Join(root, "note.md")
	if err := os.WriteFile(p, []byte("v0"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := reviewstore.Ingest("works", "note.md"); err != nil {
		t.Fatalf("Ingest: %v", err)
	}
	if err := checkWriteGuard("works", "note.md", p, false); err != nil {
		t.Fatalf("checkWriteGuard with no last_read = %v, want nil", err)
	}
}

func TestCheckWriteGuard_Unchanged_Allows(t *testing.T) {
	root := withRoots(t)
	t.Setenv("REVIEWER_CONFIG_DIR", t.TempDir())
	body := "unchanged\n"
	rel := setupDoc(t, root, body)

	if err := checkWriteGuard("works", rel, filepath.Join(root, rel), false); err != nil {
		t.Fatalf("checkWriteGuard on an unchanged file = %v, want nil", err)
	}
}

func TestCheckWriteGuard_Drifted_BlocksWithoutForce(t *testing.T) {
	root := withRoots(t)
	t.Setenv("REVIEWER_CONFIG_DIR", t.TempDir())
	body := "v0\n"
	rel := setupDoc(t, root, body)
	p := filepath.Join(root, rel)
	if err := os.WriteFile(p, []byte("v1\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	err := checkWriteGuard("works", rel, p, false)
	if err == nil {
		t.Fatal("checkWriteGuard succeeded despite drift; want a blocking error")
	}
	if !strings.Contains(err.Error(), "変更されています") || !strings.Contains(err.Error(), "--force") {
		t.Errorf("error message = %q, missing expected guidance", err)
	}
}

// TestCheckWriteGuard_NoRevisionForTheDrift_OmitsAuthor covers the Web-UI-
// save-without-copy-button path: the on-disk edit changed the body but no
// revision covers it yet (revisionsAfter is empty), so the author is
// genuinely unknown. The message must omit the author entirely rather than
// print the meaningless placeholder "unknown".
func TestCheckWriteGuard_NoRevisionForTheDrift_OmitsAuthor(t *testing.T) {
	root := withRoots(t)
	t.Setenv("REVIEWER_CONFIG_DIR", t.TempDir())
	body := "v0\n"
	rel := setupDoc(t, root, body)
	p := filepath.Join(root, rel)
	// No AppendRevision call — mirrors a Web UI save (PUT /api/files) that
	// nobody snapshotted via the copy button.
	if err := os.WriteFile(p, []byte("v1\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	err := checkWriteGuard("works", rel, p, false)
	if err == nil {
		t.Fatal("checkWriteGuard succeeded despite drift; want a blocking error")
	}
	if strings.Contains(err.Error(), "unknown") {
		t.Errorf("error message = %q, must not print the placeholder %q", err, "unknown")
	}
	if !strings.Contains(err.Error(), "+1 -1") {
		t.Errorf("error message = %q, missing the +/- stats", err)
	}
	if strings.Contains(err.Error(), "+1 -1, ") {
		t.Errorf("error message = %q, must not have a trailing author after the stats when none is known", err)
	}
}

func TestCheckWriteGuard_Drifted_ForceAllows(t *testing.T) {
	root := withRoots(t)
	t.Setenv("REVIEWER_CONFIG_DIR", t.TempDir())
	body := "v0\n"
	rel := setupDoc(t, root, body)
	p := filepath.Join(root, rel)
	if err := os.WriteFile(p, []byte("v1\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := checkWriteGuard("works", rel, p, true); err != nil {
		t.Fatalf("checkWriteGuard with --force = %v, want nil", err)
	}
}

func TestCmdReply_BlocksOnDrift_ForceOverrides(t *testing.T) {
	root := withRoots(t)
	t.Setenv("REVIEWER_CONFIG_DIR", t.TempDir())
	body := "v0\n"
	rel := setupDoc(t, root, body)
	p := filepath.Join(root, rel)
	cm, err := reviewstore.AddComment("works", rel, reviewstore.Comment{Scope: "global", Body: "x", Status: reviewstore.StatusOpen})
	if err != nil {
		t.Fatalf("AddComment: %v", err)
	}
	if wErr := os.WriteFile(p, []byte("v1\n"), 0o644); wErr != nil {
		t.Fatal(wErr)
	}

	if rErr := cmdReply([]string{p, cm.ID, "reply text"}); rErr == nil {
		t.Fatal("cmdReply succeeded despite drift")
	}

	if rErr := cmdReply([]string{p, cm.ID, "reply text", "--force"}); rErr != nil {
		t.Fatalf("cmdReply with --force = %v, want nil", rErr)
	}
	got, ok, err := lookupComment(rel, cm.ID)
	if err != nil || !ok {
		t.Fatalf("lookupComment: ok=%v err=%v", ok, err)
	}
	if len(got.Replies) != 1 || got.Replies[0].Body != "reply text" {
		t.Fatalf("replies = %+v", got.Replies)
	}
}

func TestCmdSetStatus_BlocksOnDrift_ForceOverrides(t *testing.T) {
	root := withRoots(t)
	t.Setenv("REVIEWER_CONFIG_DIR", t.TempDir())
	body := "v0\n"
	rel := setupDoc(t, root, body)
	p := filepath.Join(root, rel)
	cm, err := reviewstore.AddComment("works", rel, reviewstore.Comment{Scope: "global", Body: "x", Status: reviewstore.StatusOpen})
	if err != nil {
		t.Fatalf("AddComment: %v", err)
	}
	if wErr := os.WriteFile(p, []byte("v1\n"), 0o644); wErr != nil {
		t.Fatal(wErr)
	}

	if sErr := cmdSetStatus([]string{p, cm.ID}, reviewstore.StatusResolved); sErr == nil {
		t.Fatal("cmdSetStatus (resolve) succeeded despite drift")
	}
	if sErr := cmdSetStatus([]string{p, cm.ID, "--force"}, reviewstore.StatusResolved); sErr != nil {
		t.Fatalf("cmdSetStatus with --force = %v, want nil", sErr)
	}
	got, ok, err := lookupComment(rel, cm.ID)
	if err != nil || !ok {
		t.Fatalf("lookupComment: ok=%v err=%v", ok, err)
	}
	if got.Status != reviewstore.StatusResolved {
		t.Fatalf("status = %q, want resolved", got.Status)
	}
}

// TestCheckWriteGuard_DoesNotRecordLastRead confirms the guard never moves
// the last_read baseline itself — issue #322 requires that a blocked write
// leave last_read untouched so `mr diff --since-last-read` still shows the
// caller exactly what changed.
func TestCheckWriteGuard_DoesNotRecordLastRead(t *testing.T) {
	root := withRoots(t)
	t.Setenv("REVIEWER_CONFIG_DIR", t.TempDir())
	body := "v0\n"
	rel := setupDoc(t, root, body)
	before, _, err := reviewstore.ReadLastRead("works", rel)
	if err != nil {
		t.Fatalf("ReadLastRead: %v", err)
	}
	p := filepath.Join(root, rel)
	if wErr := os.WriteFile(p, []byte("v1\n"), 0o644); wErr != nil {
		t.Fatal(wErr)
	}

	_ = checkWriteGuard("works", rel, p, false)

	after, ok, err := reviewstore.ReadLastRead("works", rel)
	if err != nil || !ok {
		t.Fatalf("ReadLastRead after guard: ok=%v err=%v", ok, err)
	}
	if after != before {
		t.Fatalf("last_read changed after a blocked write: before=%+v after=%+v", before, after)
	}
}
