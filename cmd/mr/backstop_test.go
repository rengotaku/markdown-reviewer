package main

import (
	"os"
	"path/filepath"
	"testing"

	"markdown-reviewer/internal/reviewstore"
)

// TestReadForReview_WebUISaveWithoutCopyButton_RecordsHumanRevision is the
// end-to-end regression for issue #322's "抜ける経路": the Web UI's PUT
// /api/files deliberately never snapshots a revision (#280) and marks its
// own write via RecordAppWrite so SyncExternalEdit treats it as "not
// external" — correct for SyncExternalEdit's own purpose, but it means a
// human save that nobody copied `mr comments` for leaves no revision at all.
// readForReview's backstop must catch this from last_read alone and append
// a "human" revision before the AI reads on.
func TestReadForReview_WebUISaveWithoutCopyButton_RecordsHumanRevision(t *testing.T) {
	root := withRoots(t)
	t.Setenv("REVIEWER_CONFIG_DIR", t.TempDir())
	rel := "doc.md"
	p := filepath.Join(root, rel)

	oldBody := "# Title\n\noriginal text\n"
	if err := os.WriteFile(p, []byte(oldBody), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := reviewstore.Ingest("works", rel); err != nil {
		t.Fatalf("Ingest: %v", err)
	}
	rev0, _, err := reviewstore.AppendRevision("works", rel, "human", oldBody)
	if err != nil {
		t.Fatalf("AppendRevision oldBody: %v", err)
	}
	// An earlier tracked read (`mr comments`) stamped last_read against
	// oldBody, exactly like readForReview + recordLastRead would.
	if lrErr := reviewstore.RecordLastRead("works", rel, reviewstore.ShortSha(oldBody), rev0.ID); lrErr != nil {
		t.Fatalf("RecordLastRead: %v", lrErr)
	}

	// The Web UI saves a human edit through PUT /api/files: content changes
	// on disk, but (per #280) no revision is appended — only the app-write
	// marker is recorded, which is what makes this path fall through
	// SyncExternalEdit undetected.
	newBody := "# Title\n\nhuman edited text\n"
	if wErr := os.WriteFile(p, []byte(newBody), 0o644); wErr != nil {
		t.Fatal(wErr)
	}
	if awErr := reviewstore.RecordAppWrite("works", rel, newBody); awErr != nil {
		t.Fatalf("RecordAppWrite: %v", awErr)
	}

	// Nobody clicked "copy mr comments" (that's the only thing that would
	// otherwise have snapshotted newBody as a "human" revision) — an AI just
	// runs `mr comments` straight from the terminal.
	_, _, _, _, err = readForReview(p)
	if err != nil {
		t.Fatalf("readForReview: %v", err)
	}

	metas, err := reviewstore.ListRevisions("works", rel)
	if err != nil {
		t.Fatalf("ListRevisions: %v", err)
	}
	if len(metas) != 2 {
		t.Fatalf("expected the human's web-UI save to be snapshotted as a new revision, got %d: %+v", len(metas), metas)
	}
	if metas[0].Author != "human" {
		t.Errorf("newest revision author = %q, want %q (the backstop must label it human)", metas[0].Author, "human")
	}
	newest, found, err := reviewstore.GetRevision("works", rel, metas[0].ID)
	if err != nil || !found {
		t.Fatalf("GetRevision: found=%v err=%v", found, err)
	}
	if newest.Content != newBody {
		t.Fatalf("snapshotted content = %q, want %q", newest.Content, newBody)
	}
}

// TestReadForReview_NoLastRead_DoesNotBackstop confirms the backstop is
// inert before any tracked read has ever run (there is nothing to compare
// the current body against yet, so SyncExternalEdit's own baseline-snapshot
// behavior on first read is left alone rather than double-appending).
func TestReadForReview_NoLastRead_DoesNotBackstop(t *testing.T) {
	root := withRoots(t)
	t.Setenv("REVIEWER_CONFIG_DIR", t.TempDir())
	rel := "doc.md"
	p := filepath.Join(root, rel)
	body := "content\n"
	if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := reviewstore.Ingest("works", rel); err != nil {
		t.Fatalf("Ingest: %v", err)
	}

	if _, _, _, _, err := readForReview(p); err != nil {
		t.Fatalf("readForReview: %v", err)
	}

	metas, err := reviewstore.ListRevisions("works", rel)
	if err != nil {
		t.Fatalf("ListRevisions: %v", err)
	}
	// SyncExternalEdit's own len(revs)==0 branch snapshots exactly one
	// baseline; the backstop must not add a second one on top of it.
	if len(metas) != 1 {
		t.Fatalf("expected exactly 1 revision (SyncExternalEdit's baseline), got %d: %+v", len(metas), metas)
	}
}
