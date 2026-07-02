package reviewstore

import (
	"testing"
)

// syncTestHint is a realistic AI hint block so the tests prove hint churn is
// invisible to drift detection.
const syncTestHint = "<!-- markdown-reviewer\n本文はクリーンです。\nCLI(推奨):  mr review <path>\n-->\n\n"

// setupSyncStore points the store at a temp dir and ingests one file with a
// single anchored comment, returning the (root, rel) pair and the anchor.
func setupSyncStore(t *testing.T) (root, rel string) {
	t.Helper()
	t.Setenv(configDirEnv, t.TempDir())
	root, rel = "rooms", "sub/doc.md"
	if err := Ingest(root, rel); err != nil {
		t.Fatalf("ingest: %v", err)
	}
	return root, rel
}

func addAnchoredComment(t *testing.T, root, rel string, a Anchor) Comment {
	t.Helper()
	cm, err := AddComment(root, rel, Comment{Scope: "inline", Body: "fix this", Anchor: &a})
	if err != nil {
		t.Fatalf("add comment: %v", err)
	}
	return cm
}

func revisionsOf(t *testing.T, root, rel string) []RevisionMeta {
	t.Helper()
	revs, err := ListRevisions(root, rel)
	if err != nil {
		t.Fatalf("list revisions: %v", err)
	}
	return revs
}

func TestSyncExternalEdit_NotIngested_Noop(t *testing.T) {
	t.Setenv(configDirEnv, t.TempDir())
	synced, err := SyncExternalEdit("rooms", "nope.md", "# hi\n")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if synced {
		t.Fatalf("expected synced=false for un-ingested file")
	}
	if HasEntry("rooms", "nope.md") {
		t.Fatalf("sync must not create an entry for a draft file")
	}
}

func TestSyncExternalEdit_NoHistory_EstablishesBaseline(t *testing.T) {
	root, rel := setupSyncStore(t)
	raw := syncTestHint + "# Title\n\nThe quick brown fox jumps.\n"

	synced, err := SyncExternalEdit(root, rel, raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if synced {
		t.Fatalf("baseline snapshot is not a sync; expected synced=false")
	}
	revs := revisionsOf(t, root, rel)
	if len(revs) != 1 {
		t.Fatalf("expected 1 baseline revision, got %d", len(revs))
	}
	if revs[0].Author != "external" {
		t.Errorf("baseline author = %q, want %q", revs[0].Author, "external")
	}
	// The stored snapshot must be hint-stripped like every other revision.
	rev, ok, err := GetRevision(root, rel, revs[0].ID)
	if err != nil || !ok {
		t.Fatalf("get revision: ok=%v err=%v", ok, err)
	}
	if rev.Content != "# Title\n\nThe quick brown fox jumps.\n" {
		t.Errorf("baseline content not hint-stripped: %q", rev.Content)
	}
}

func TestSyncExternalEdit_InSync_Noop(t *testing.T) {
	root, rel := setupSyncStore(t)
	body := "# Title\n\nThe quick brown fox jumps.\n"
	if _, _, err := AppendRevision(root, rel, "human", body); err != nil {
		t.Fatalf("seed revision: %v", err)
	}

	// Raw disk content differs only by the hint block: no drift.
	synced, err := SyncExternalEdit(root, rel, syncTestHint+body)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if synced {
		t.Fatalf("hint-only difference must not count as an external edit")
	}
	if revs := revisionsOf(t, root, rel); len(revs) != 1 {
		t.Fatalf("expected no new revision, got %d", len(revs))
	}
}

func TestSyncExternalEdit_Drift_ReanchorsAndSnapshots(t *testing.T) {
	root, rel := setupSyncStore(t)
	oldBody := "# Title\n\nThe quick brown fox jumps.\n\nAnother paragraph.\n"
	newRaw := syncTestHint + "# Title\n\nThe quick RED fox leaps high.\n\nAnother paragraph.\n"

	if _, _, err := AppendRevision(root, rel, "human", oldBody); err != nil {
		t.Fatalf("seed revision: %v", err)
	}
	cm := addAnchoredComment(t, root, rel, Anchor{
		HeadingPath: []string{"# Title"},
		Snippet:     "quick brown fox jumps",
		Occurrence:  0,
	})

	synced, err := SyncExternalEdit(root, rel, newRaw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !synced {
		t.Fatalf("expected synced=true for a drifted body")
	}

	// The comment's anchor must now resolve against the raw new content, at
	// the rewritten line (line 8: 5 hint lines + heading + blank).
	review, err := ReadReview(root, rel)
	if err != nil {
		t.Fatalf("read review: %v", err)
	}
	var got *Anchor
	for _, c := range review.Comments {
		if c.ID == cm.ID {
			got = c.Anchor
		}
	}
	if got == nil {
		t.Fatalf("comment %s lost its anchor", cm.ID)
	}
	lr, ok := ResolveAnchor(newRaw, *got)
	if !ok {
		t.Fatalf("re-anchored comment still orphaned (anchor=%+v)", *got)
	}
	if wantLine := 8; lr[0] != wantLine {
		t.Errorf("re-anchored line = %d, want %d", lr[0], wantLine)
	}

	// A new revision with the hint-stripped external content must exist.
	revs := revisionsOf(t, root, rel)
	if len(revs) != 2 {
		t.Fatalf("expected 2 revisions after sync, got %d", len(revs))
	}
	if revs[0].Author != "external" {
		t.Errorf("newest revision author = %q, want %q", revs[0].Author, "external")
	}
}

func TestSyncExternalEdit_DeletedLine_StaysHonestOrphan(t *testing.T) {
	root, rel := setupSyncStore(t)
	oldBody := "# Title\n\nDelete me entirely.\n\nKeep this line.\n"
	newRaw := "# Title\n\nKeep this line.\n"

	if _, _, err := AppendRevision(root, rel, "human", oldBody); err != nil {
		t.Fatalf("seed revision: %v", err)
	}
	anchor := Anchor{HeadingPath: []string{"# Title"}, Snippet: "Delete me entirely", Occurrence: 0}
	cm := addAnchoredComment(t, root, rel, anchor)

	synced, err := SyncExternalEdit(root, rel, newRaw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !synced {
		t.Fatalf("expected synced=true: the body did drift")
	}

	review, err := ReadReview(root, rel)
	if err != nil {
		t.Fatalf("read review: %v", err)
	}
	for _, c := range review.Comments {
		if c.ID == cm.ID {
			if c.Anchor.Snippet != anchor.Snippet || c.Anchor.Occurrence != anchor.Occurrence {
				t.Errorf("anchor for a deleted line must stay untouched, got %+v", *c.Anchor)
			}
			if _, ok := ResolveAnchor(newRaw, *c.Anchor); ok {
				t.Errorf("anchor unexpectedly resolves against the new body")
			}
		}
	}
	if revs := revisionsOf(t, root, rel); len(revs) != 2 {
		t.Fatalf("expected the external content snapshotted even when orphaned, got %d revisions", len(revs))
	}
}

func TestSyncExternalEdit_SecondCall_IsIdempotent(t *testing.T) {
	root, rel := setupSyncStore(t)
	oldBody := "# Title\n\nThe quick brown fox jumps.\n"
	newRaw := "# Title\n\nThe quick RED fox leaps high.\n"

	if _, _, err := AppendRevision(root, rel, "human", oldBody); err != nil {
		t.Fatalf("seed revision: %v", err)
	}
	addAnchoredComment(t, root, rel, Anchor{
		HeadingPath: []string{"# Title"},
		Snippet:     "quick brown fox jumps",
		Occurrence:  0,
	})

	if _, err := SyncExternalEdit(root, rel, newRaw); err != nil {
		t.Fatalf("first sync: %v", err)
	}
	synced, err := SyncExternalEdit(root, rel, newRaw)
	if err != nil {
		t.Fatalf("second sync: %v", err)
	}
	if synced {
		t.Fatalf("second sync with identical content must be a no-op")
	}
	if revs := revisionsOf(t, root, rel); len(revs) != 2 {
		t.Fatalf("expected 2 revisions after idempotent re-sync, got %d", len(revs))
	}
}

func TestStripAIHint(t *testing.T) {
	body := "# Title\n\ntext\n"
	if got := StripAIHint(syncTestHint + body); got != body {
		t.Errorf("StripAIHint = %q, want %q", got, body)
	}
	// No hint: unchanged.
	if got := StripAIHint(body); got != body {
		t.Errorf("StripAIHint without hint = %q, want %q", got, body)
	}
	// A mid-file comment is not a hint block.
	mid := "# Title\n\n<!-- markdown-reviewer -->\n"
	if got := StripAIHint(mid); got != mid {
		t.Errorf("mid-file comment stripped: %q", got)
	}
}
