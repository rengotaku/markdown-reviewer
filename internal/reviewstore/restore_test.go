package reviewstore

import "testing"

func TestRestore_WritesBackTargetContentWithHint(t *testing.T) {
	withTempStore(t)
	const root, rel = "rooms", "doc.md"
	if err := Ingest(root, rel); err != nil {
		t.Fatalf("Ingest: %v", err)
	}
	if _, _, err := AppendRevision(root, rel, "human", "# Title\n\nOld body.\n"); err != nil {
		t.Fatalf("AppendRevision: %v", err)
	}
	metas, err := ListRevisions(root, rel)
	if err != nil || len(metas) != 1 {
		t.Fatalf("precondition: expected 1 revision, got %+v (err=%v)", metas, err)
	}
	targetID := metas[0].ID

	hinted := "<!-- markdown-reviewer\nhint body\n-->\n\n# Title\n\nCurrent body, edited since.\n"
	newRaw, found, err := Restore(root, rel, targetID, "human", hinted)
	if err != nil {
		t.Fatalf("Restore: %v", err)
	}
	if !found {
		t.Fatalf("expected found=true for a real revision id")
	}
	want := "<!-- markdown-reviewer\nhint body\n-->\n\n# Title\n\nOld body.\n"
	if newRaw != want {
		t.Fatalf("restored content mismatch:\ngot:  %q\nwant: %q", newRaw, want)
	}
}

func TestRestore_AppendsBeforeContentAsNewRevision(t *testing.T) {
	withTempStore(t)
	const root, rel = "rooms", "doc.md"
	if err := Ingest(root, rel); err != nil {
		t.Fatalf("Ingest: %v", err)
	}
	if _, _, err := AppendRevision(root, rel, "human", "body v1"); err != nil {
		t.Fatalf("AppendRevision: %v", err)
	}
	metas, err := ListRevisions(root, rel)
	if err != nil || len(metas) != 1 {
		t.Fatalf("precondition: expected 1 revision, got %+v (err=%v)", metas, err)
	}
	v1ID := metas[0].ID

	current := "body v2 (current, about to be overwritten)"
	if _, found, rerr := Restore(root, rel, v1ID, "human", current); rerr != nil || !found {
		t.Fatalf("Restore: found=%v err=%v", found, rerr)
	}

	metas, err = ListRevisions(root, rel)
	if err != nil {
		t.Fatalf("ListRevisions after restore: %v", err)
	}
	if len(metas) != 2 {
		t.Fatalf("expected the pre-restore body to be appended as a new revision, got %d revisions: %+v", len(metas), metas)
	}
	// Newest-first: the snapshot of `current` must be the top entry, and
	// restoring again by its id must bring back v2 — i.e. the restore is
	// itself undoable.
	v2ID := metas[0].ID
	restoredAgain, found, err := Restore(root, rel, v2ID, "human", "body v1 (now current after the first restore)")
	if err != nil || !found {
		t.Fatalf("undo Restore: found=%v err=%v", found, err)
	}
	if restoredAgain != current {
		t.Fatalf("undo restore mismatch: got %q want %q", restoredAgain, current)
	}
}

func TestRestore_ReanchorsCommentsFromCurrentToRestoredBody(t *testing.T) {
	withTempStore(t)
	const root, rel = "rooms", "doc.md"
	if err := Ingest(root, rel); err != nil {
		t.Fatalf("Ingest: %v", err)
	}

	oldBody := "# Title\n\nThe quick brown fox jumps.\n\nAnother paragraph.\n"
	if _, _, err := AppendRevision(root, rel, "human", oldBody); err != nil {
		t.Fatalf("AppendRevision: %v", err)
	}
	metas, err := ListRevisions(root, rel)
	if err != nil || len(metas) != 1 {
		t.Fatalf("precondition: expected 1 revision, got %+v (err=%v)", metas, err)
	}
	targetID := metas[0].ID

	// The comment was anchored against oldBody's line 3. The "current" body
	// (about to be overwritten by the restore) has since rewritten that line,
	// which would orphan the anchor without a reanchor step.
	anchor := Anchor{HeadingPath: []string{"# Title"}, Snippet: "quick brown fox jumps", Occurrence: 0}
	if _, aerr := AddComment(root, rel, Comment{Scope: "inline", Body: "x", Anchor: &anchor}); aerr != nil {
		t.Fatalf("AddComment: %v", aerr)
	}

	currentBody := "# Title\n\nThe quick RED fox leaps high.\n\nAnother paragraph.\n"
	restored, found, err := Restore(root, rel, targetID, "human", currentBody)
	if err != nil || !found {
		t.Fatalf("Restore: found=%v err=%v", found, err)
	}
	if restored != oldBody {
		t.Fatalf("restored body mismatch: got %q want %q", restored, oldBody)
	}

	review, err := ReadReview(root, rel)
	if err != nil {
		t.Fatalf("ReadReview: %v", err)
	}
	if len(review.Comments) != 1 {
		t.Fatalf("expected 1 comment, got %d", len(review.Comments))
	}
	got := review.Comments[0].Anchor
	if got == nil {
		t.Fatalf("anchor became nil")
	}
	if _, ok := ResolveAnchor(restored, *got); !ok {
		t.Fatalf("expected the anchor to resolve against the restored body, got %+v", got)
	}
}

func TestRestore_UnknownID_NotFound(t *testing.T) {
	withTempStore(t)
	const root, rel = "rooms", "doc.md"
	if err := Ingest(root, rel); err != nil {
		t.Fatalf("Ingest: %v", err)
	}
	if _, _, err := AppendRevision(root, rel, "human", "body"); err != nil {
		t.Fatalf("AppendRevision: %v", err)
	}
	_, found, err := Restore(root, rel, "r-999", "human", "current")
	if err != nil {
		t.Fatalf("Restore: unexpected error %v", err)
	}
	if found {
		t.Fatalf("expected found=false for an unknown revision id")
	}
}

func TestRestore_UnIngestedOrHistoryLessFile_NotFoundNoPanic(t *testing.T) {
	withTempStore(t)

	// Never ingested at all: GetRevision reports "not found" rather than
	// erroring, and Restore must not panic reaching for a nonexistent
	// history file.
	if _, found, err := Restore("rooms", "never-ingested.md", "r-001", "human", "current"); err != nil || found {
		t.Fatalf("never-ingested: found=%v err=%v, want found=false, err=nil", found, err)
	}

	// Ingested but no revisions appended yet: same outcome, no panic.
	if err := Ingest("rooms", "no-history.md"); err != nil {
		t.Fatalf("Ingest: %v", err)
	}
	if _, found, err := Restore("rooms", "no-history.md", "r-001", "human", "current"); err != nil || found {
		t.Fatalf("history-less: found=%v err=%v, want found=false, err=nil", found, err)
	}
}
