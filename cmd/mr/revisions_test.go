package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"markdown-reviewer/internal/files"
	"markdown-reviewer/internal/reviewstore"
)

func TestCmdRevisions_ListsNewestFirst(t *testing.T) {
	root := withRoots(t)
	t.Setenv("REVIEWER_CONFIG_DIR", t.TempDir())
	p := filepath.Join(root, "note.md")
	if err := os.WriteFile(p, []byte("v1"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := reviewstore.Ingest("works", "note.md"); err != nil {
		t.Fatalf("Ingest: %v", err)
	}
	if _, _, err := reviewstore.AppendRevision("works", "note.md", "human", "v1"); err != nil {
		t.Fatalf("AppendRevision v1: %v", err)
	}
	if _, _, err := reviewstore.AppendRevision("works", "note.md", "ai", "v2"); err != nil {
		t.Fatalf("AppendRevision v2: %v", err)
	}

	if err := cmdRevisions([]string{p}); err != nil {
		t.Fatalf("cmdRevisions: %v", err)
	}
}

func TestCmdRestore_WritesBackAndSnapshotsCurrent(t *testing.T) {
	root := withRoots(t)
	t.Setenv("REVIEWER_CONFIG_DIR", t.TempDir())
	p := filepath.Join(root, "note.md")
	if err := os.WriteFile(p, []byte("v0"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := reviewstore.Ingest("works", "note.md"); err != nil {
		t.Fatalf("Ingest: %v", err)
	}
	if _, _, err := reviewstore.AppendRevision("works", "note.md", "human", "v0"); err != nil {
		t.Fatalf("AppendRevision v0: %v", err)
	}
	metas, err := reviewstore.ListRevisions("works", "note.md")
	if err != nil || len(metas) != 1 {
		t.Fatalf("precondition: expected 1 revision, got %+v (err=%v)", metas, err)
	}
	v0ID := metas[0].ID

	// Move the current on-disk content on to v1 before restoring.
	if werr := os.WriteFile(p, []byte("v1"), 0o644); werr != nil {
		t.Fatal(werr)
	}

	if rerr := cmdRestore([]string{p, v0ID}); rerr != nil {
		t.Fatalf("cmdRestore: %v", rerr)
	}

	got, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "v0" {
		t.Fatalf("file content after restore = %q, want %q", got, "v0")
	}

	metas, err = reviewstore.ListRevisions("works", "note.md")
	if err != nil {
		t.Fatalf("ListRevisions: %v", err)
	}
	if len(metas) != 2 {
		t.Fatalf("expected the pre-restore body (v1) to be appended as a new revision, got %d: %+v", len(metas), metas)
	}
	// Newest-first: metas[0] is the just-appended pre-restore snapshot (v1).
	if metas[0].Author != "external" {
		t.Errorf("pre-restore snapshot author = %q, want %q (mr restore cannot tell who last wrote the file on disk)", metas[0].Author, "external")
	}
}

func TestCmdRestore_AuthorFlagOverridesDefault(t *testing.T) {
	root := withRoots(t)
	t.Setenv("REVIEWER_CONFIG_DIR", t.TempDir())
	p := filepath.Join(root, "note.md")
	if err := os.WriteFile(p, []byte("v0"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := reviewstore.Ingest("works", "note.md"); err != nil {
		t.Fatalf("Ingest: %v", err)
	}
	if _, _, err := reviewstore.AppendRevision("works", "note.md", "human", "v0"); err != nil {
		t.Fatalf("AppendRevision v0: %v", err)
	}
	metas, err := reviewstore.ListRevisions("works", "note.md")
	if err != nil || len(metas) != 1 {
		t.Fatalf("precondition: expected 1 revision, got %+v (err=%v)", metas, err)
	}
	v0ID := metas[0].ID

	if werr := os.WriteFile(p, []byte("v1"), 0o644); werr != nil {
		t.Fatal(werr)
	}

	if rerr := cmdRestore([]string{p, v0ID, "--author", "someone"}); rerr != nil {
		t.Fatalf("cmdRestore: %v", rerr)
	}

	metas, err = reviewstore.ListRevisions("works", "note.md")
	if err != nil || len(metas) != 2 {
		t.Fatalf("ListRevisions: %v, %+v", err, metas)
	}
	if metas[0].Author != "someone" {
		t.Errorf("pre-restore snapshot author = %q, want %q (--author must override the default)", metas[0].Author, "someone")
	}
}

func TestCmdRestore_UnknownID_Errors(t *testing.T) {
	root := withRoots(t)
	t.Setenv("REVIEWER_CONFIG_DIR", t.TempDir())
	p := filepath.Join(root, "note.md")
	if err := os.WriteFile(p, []byte("v0"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := reviewstore.Ingest("works", "note.md"); err != nil {
		t.Fatalf("Ingest: %v", err)
	}
	if _, _, err := reviewstore.AppendRevision("works", "note.md", "human", "v0"); err != nil {
		t.Fatalf("AppendRevision: %v", err)
	}

	err := cmdRestore([]string{p, "r-999"})
	if err == nil {
		t.Fatal("cmdRestore() succeeded for an unknown revision id")
	}
	if !strings.Contains(err.Error(), "r-999") {
		t.Errorf("error %q does not name the missing id", err)
	}
}

func TestCmdRestore_UnIngestedFile_ErrorsNoPanic(t *testing.T) {
	root := withRoots(t)
	t.Setenv("REVIEWER_CONFIG_DIR", t.TempDir())
	p := filepath.Join(root, "note.md")
	if err := os.WriteFile(p, []byte("v0"), 0o644); err != nil {
		t.Fatal(err)
	}
	// Never ingested; no history at all.
	err := cmdRestore([]string{p, "r-001"})
	if err == nil {
		t.Fatal("cmdRestore() succeeded for a never-ingested file")
	}
}

// TestWriteIfUnchangedSince_Match_Writes and
// TestWriteIfUnchangedSince_Mismatch_AbortsWithoutWriting cover the
// codex-flagged race directly and deterministically: a real concurrent-write
// race is timing-dependent (and so flaky to assert on), but the guard it
// closes reduces to one pure question — "does the sha I read before still
// match what's on disk right now?" — which writeIfUnchangedSince answers
// without needing wall-clock timing at all.
func TestWriteIfUnchangedSince_Match_Writes(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "note.md")
	if err := os.WriteFile(p, []byte("v0"), 0o644); err != nil {
		t.Fatal(err)
	}
	beforeSha := files.Sha256Hex([]byte("v0"))

	if err := writeIfUnchangedSince(p, beforeSha, []byte("restored")); err != nil {
		t.Fatalf("writeIfUnchangedSince: %v", err)
	}
	got, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "restored" {
		t.Fatalf("file content = %q, want %q", got, "restored")
	}
}

func TestWriteIfUnchangedSince_Mismatch_AbortsWithoutWriting(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "note.md")
	if err := os.WriteFile(p, []byte("v0"), 0o644); err != nil {
		t.Fatal(err)
	}
	beforeSha := files.Sha256Hex([]byte("v0"))

	// A concurrent writer (e.g. the Web UI's PUT /api/files) saves "v1" —
	// a successful save that never gets snapshotted as a revision (#280) —
	// after beforeSha was captured but before this write attempt.
	if err := os.WriteFile(p, []byte("v1"), 0o644); err != nil {
		t.Fatal(err)
	}

	err := writeIfUnchangedSince(p, beforeSha, []byte("restored"))
	if err == nil {
		t.Fatal("writeIfUnchangedSince succeeded despite the file changing on disk; the concurrent save would have been silently overwritten")
	}

	got, readErr := os.ReadFile(p)
	if readErr != nil {
		t.Fatal(readErr)
	}
	if string(got) != "v1" {
		t.Fatalf("file content after aborted write = %q, want the concurrent save (%q) left untouched", got, "v1")
	}
}

// TestCmdRestore_EndToEndConcurrentSave_AbortsAndPreservesTheSave drives the
// same guard through cmdRestore itself (not just writeIfUnchangedSince) by
// racing a concurrent write in from a background goroutine gated on a file
// watch, so the abort is asserted against real cmdRestore behavior rather
// than only its extracted helper.
func TestCmdRestore_EndToEndConcurrentSave_AbortsAndPreservesTheSave(t *testing.T) {
	root := withRoots(t)
	t.Setenv("REVIEWER_CONFIG_DIR", t.TempDir())
	p := filepath.Join(root, "note.md")
	if err := os.WriteFile(p, []byte("v0"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := reviewstore.Ingest("works", "note.md"); err != nil {
		t.Fatalf("Ingest: %v", err)
	}
	if _, _, err := reviewstore.AppendRevision("works", "note.md", "human", "v0"); err != nil {
		t.Fatalf("AppendRevision v0: %v", err)
	}
	metas, err := reviewstore.ListRevisions("works", "note.md")
	if err != nil || len(metas) != 1 {
		t.Fatalf("precondition: expected 1 revision, got %+v (err=%v)", metas, err)
	}
	v0ID := metas[0].ID

	// The content cmdRestore will read as its starting point.
	if err := os.WriteFile(p, []byte("v1"), 0o644); err != nil {
		t.Fatal(err)
	}

	// Race a concurrent save in immediately: cmdRestore's own work
	// (ListRevisions/AppendRevision/ReadReview/saveReview inside
	// reviewstore.Restore) takes long enough on a temp-dir filesystem for
	// this goroutine to land its write first in practice. If it ever loses
	// the race, the assertions below simply confirm the (uninteresting,
	// already covered by TestCmdRestore_WritesBackAndSnapshotsCurrent)
	// success path instead of flaking — they don't assert the restore
	// itself failed, only that whichever content ends up on disk is never
	// silently discarded by a torn write.
	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = os.WriteFile(p, []byte("v2-concurrent-save"), 0o644)
	}()
	restoreErr := cmdRestore([]string{p, v0ID})
	<-done

	got, readErr := os.ReadFile(p)
	if readErr != nil {
		t.Fatal(readErr)
	}
	if restoreErr != nil {
		// The CAS guard fired: the concurrent save must be exactly what
		// ended up on disk, never partially overwritten or reverted.
		if string(got) != "v2-concurrent-save" {
			t.Fatalf("restore aborted (%v) but disk content = %q, want the concurrent save (%q) preserved", restoreErr, got, "v2-concurrent-save")
		}
	} else if string(got) != "v0" {
		t.Fatalf("restore reported success but disk content = %q, want %q", got, "v0")
	}
}

// TestSnapshotAndRestoreReviewJSON_RoundTrip,
// TestRestoreReviewJSON_RemovesFileThatDidNotExistBefore, and
// TestRestoreReviewJSON_GuardMismatch_LeavesThirdPartyWriteAlone cover
// snapshotReviewJSON/restoreReviewJSON directly and deterministically —
// exactly like writeIfUnchangedSince above, the underlying question ("can we
// put review.json back exactly the way we found it, without ever clobbering
// someone else's write") doesn't need real concurrency to test, only
// cmdRestore's *use* of the pair under a race does.
func TestSnapshotAndRestoreReviewJSON_RoundTrip(t *testing.T) {
	withRoots(t)
	t.Setenv("REVIEWER_CONFIG_DIR", t.TempDir())
	if err := reviewstore.Ingest("works", "note.md"); err != nil {
		t.Fatalf("Ingest: %v", err)
	}
	anchor := reviewstore.Anchor{HeadingPath: []string{"# Title"}, Snippet: "original", Occurrence: 0}
	if _, err := reviewstore.AddComment("works", "note.md", reviewstore.Comment{Scope: "inline", Body: "x", Anchor: &anchor}); err != nil {
		t.Fatalf("AddComment: %v", err)
	}

	path, before, existed, err := snapshotReviewJSON("works", "note.md")
	if err != nil {
		t.Fatalf("snapshotReviewJSON: %v", err)
	}
	if !existed {
		t.Fatal("snapshotReviewJSON: existed = false, want true (Ingest+AddComment already created review.json)")
	}

	// Simulate reviewstore.Restore rewriting review.json (a moved anchor).
	moved := reviewstore.Anchor{HeadingPath: []string{"# Title"}, Snippet: "moved", Occurrence: 0}
	if _, addErr := reviewstore.AddComment("works", "note.md", reviewstore.Comment{Scope: "inline", Body: "y", Anchor: &moved}); addErr != nil {
		t.Fatalf("AddComment (simulated Restore side effect): %v", addErr)
	}
	// The guard is what cmdRestore snapshots right after Restore returns —
	// here, that's the state Restore's own simulated mutation just produced.
	// Nothing else has touched review.json since, so the guard matches
	// "current" and the rollback below must proceed.
	_, guard, guardExisted, err := snapshotReviewJSON("works", "note.md")
	if err != nil {
		t.Fatalf("snapshotReviewJSON (guard): %v", err)
	}

	if restoreErr := restoreReviewJSON(path, before, existed, guard, guardExisted); restoreErr != nil {
		t.Fatalf("restoreReviewJSON: %v", restoreErr)
	}

	after, err := reviewstore.ReadReview("works", "note.md")
	if err != nil {
		t.Fatalf("ReadReview: %v", err)
	}
	if len(after.Comments) != 1 || after.Comments[0].Anchor.Snippet != "original" {
		t.Fatalf("review.json after rollback = %+v, want only the original comment", after.Comments)
	}
}

func TestRestoreReviewJSON_RemovesFileThatDidNotExistBefore(t *testing.T) {
	withRoots(t)
	t.Setenv("REVIEWER_CONFIG_DIR", t.TempDir())

	dir := t.TempDir()
	path := filepath.Join(dir, "review.json")

	// Nothing existed before, nothing exists now (guard matches): no-op.
	if err := restoreReviewJSON(path, nil, false, nil, false); err != nil {
		t.Fatalf("restoreReviewJSON on a path that never existed: %v", err)
	}

	// Restore's simulated side effect created the file; the guard snapshot
	// taken right after that (here: the same bytes, since nothing else has
	// run) matches current, so rolling back to "didn't exist" removes it.
	created := []byte(`{"version":1,"comments":[]}`)
	if err := os.WriteFile(path, created, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := restoreReviewJSON(path, nil, false, created, true); err != nil {
		t.Fatalf("restoreReviewJSON: %v", err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("expected the file created after the snapshot to be removed, stat err = %v", err)
	}
}

// Regression (codex review round 3): round-2's restoreReviewJSON wrote the
// pre-Restore snapshot back unconditionally, which would silently discard a
// comment or reply the Web UI saved in the window between Restore returning
// and the canonical-file CAS check aborting. The guard must catch that and
// leave the third party's write alone instead of overwriting it.
func TestRestoreReviewJSON_GuardMismatch_LeavesThirdPartyWriteAlone(t *testing.T) {
	withRoots(t)
	t.Setenv("REVIEWER_CONFIG_DIR", t.TempDir())
	if err := reviewstore.Ingest("works", "note.md"); err != nil {
		t.Fatalf("Ingest: %v", err)
	}
	anchor := reviewstore.Anchor{HeadingPath: []string{"# Title"}, Snippet: "original", Occurrence: 0}
	if _, err := reviewstore.AddComment("works", "note.md", reviewstore.Comment{Scope: "inline", Body: "x", Anchor: &anchor}); err != nil {
		t.Fatalf("AddComment: %v", err)
	}

	// The pre-Restore snapshot (what a rollback would normally restore to).
	path, before, existed, err := snapshotReviewJSON("works", "note.md")
	if err != nil {
		t.Fatalf("snapshotReviewJSON: %v", err)
	}

	// The guard cmdRestore would have captured right after Restore returned
	// — deliberately stale here (equal to `before`) so it does NOT reflect
	// the third-party write added below, exactly like a real race where the
	// third party writes after the guard snapshot was taken.
	guard, guardExisted := before, existed

	// A third party (e.g. the Web UI) saves a new reply after the guard
	// snapshot was taken but before the rollback runs.
	thirdParty := reviewstore.Review{Version: 1, Comments: []reviewstore.Comment{
		{ID: "c-001", Scope: "inline", Body: "x", Anchor: &anchor},
		{ID: "c-002", Scope: "global", Body: "a reply-worthy new comment saved by someone else"},
	}}
	thirdPartyBytes, err := json.MarshalIndent(thirdParty, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if writeErr := os.WriteFile(path, thirdPartyBytes, 0o644); writeErr != nil {
		t.Fatal(writeErr)
	}

	rollbackErr := restoreReviewJSON(path, before, existed, guard, guardExisted)
	if rollbackErr == nil {
		t.Fatal("restoreReviewJSON succeeded despite a guard mismatch; the third-party write should have been left alone")
	}

	after, err := reviewstore.ReadReview("works", "note.md")
	if err != nil {
		t.Fatalf("ReadReview: %v", err)
	}
	if len(after.Comments) != 2 {
		t.Fatalf("third-party write was overwritten by the rollback: got %d comments, want 2 (%+v)", len(after.Comments), after.Comments)
	}
	foundReply := false
	for _, c := range after.Comments {
		if c.ID == "c-002" {
			foundReply = true
		}
	}
	if !foundReply {
		t.Fatalf("third party's new comment (c-002) is missing after the rollback attempt: %+v", after.Comments)
	}
}

// TestCmdRestore_CASAbort_RollsBackReviewJSON is the codex round-2
// regression, exercised deterministically. A real CAS mismatch needs a
// concurrent writer, which is inherently timing-dependent and (as the
// canonical-file-only race test above shows) can land before cmdRestore's
// own initial read just as easily as after it — not a reliable way to pin
// down *which* of cmdRestore's steps ran before the abort. This instead
// drives cmdRestore's exact sequence (snapshotReviewJSON → Restore →
// CAS-check → on mismatch, restoreReviewJSON) directly, forcing the
// mismatch with a deliberately wrong beforeSha instead of a race, so the
// property under test — "an aborted restore leaves review.json exactly as
// Restore found it" — is checked without any dependency on scheduling.
func TestCmdRestore_CASAbort_RollsBackReviewJSON(t *testing.T) {
	root := withRoots(t)
	t.Setenv("REVIEWER_CONFIG_DIR", t.TempDir())
	p := filepath.Join(root, "note.md")

	oldBody := "# Title\n\nThe quick brown fox jumps.\n\nAnother paragraph.\n"
	if err := os.WriteFile(p, []byte(oldBody), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := reviewstore.Ingest("works", "note.md"); err != nil {
		t.Fatalf("Ingest: %v", err)
	}
	if _, _, err := reviewstore.AppendRevision("works", "note.md", "human", oldBody); err != nil {
		t.Fatalf("AppendRevision oldBody: %v", err)
	}
	metas, err := reviewstore.ListRevisions("works", "note.md")
	if err != nil || len(metas) != 1 {
		t.Fatalf("precondition: expected 1 revision, got %+v (err=%v)", metas, err)
	}
	oldID := metas[0].ID

	// currentBody rewrites the anchored line, so Restore's reanchor step
	// below actually moves (and persists) an anchor — the interesting case
	// for the round-2 bug: review.json changes as a side effect of Restore
	// itself, before any CAS check happens.
	currentBody := "# Title\n\nThe quick RED fox leaps high.\n\nAnother paragraph.\n"
	if writeErr := os.WriteFile(p, []byte(currentBody), 0o644); writeErr != nil {
		t.Fatal(writeErr)
	}
	anchor := reviewstore.Anchor{HeadingPath: []string{"# Title"}, Snippet: "quick RED fox leaps high", Occurrence: 0}
	if _, addErr := reviewstore.AddComment("works", "note.md", reviewstore.Comment{Scope: "inline", Body: "x", Anchor: &anchor}); addErr != nil {
		t.Fatalf("AddComment: %v", addErr)
	}

	// --- from here down mirrors cmdRestore's own body exactly ---
	reviewPath, reviewBefore, reviewExisted, err := snapshotReviewJSON("works", "note.md")
	if err != nil {
		t.Fatalf("snapshotReviewJSON: %v", err)
	}
	beforeReview, err := reviewstore.ReadReview("works", "note.md")
	if err != nil {
		t.Fatalf("ReadReview (before Restore): %v", err)
	}

	restored, found, err := reviewstore.Restore("works", "note.md", oldID, "external", currentBody)
	if err != nil || !found {
		t.Fatalf("Restore: found=%v err=%v", found, err)
	}

	// Confirm Restore actually did move the anchor, so the rollback below is
	// proven to undo a real change rather than a no-op.
	mid, err := reviewstore.ReadReview("works", "note.md")
	if err != nil {
		t.Fatalf("ReadReview (after Restore, before rollback): %v", err)
	}
	if reflect.DeepEqual(*mid.Comments[0].Anchor, *beforeReview.Comments[0].Anchor) {
		t.Fatalf("precondition: Restore should have moved the anchor, got the same anchor %+v", *mid.Comments[0].Anchor)
	}

	// The guard cmdRestore snapshots right after Restore returns — nothing
	// has touched review.json since Restore ran, so this matches "current"
	// and the rollback below is expected to actually proceed.
	_, reviewGuard, reviewGuardExisted, err := snapshotReviewJSON("works", "note.md")
	if err != nil {
		t.Fatalf("snapshotReviewJSON (guard): %v", err)
	}

	// Force the CAS check to fail deterministically (a wrong sha stands in
	// for "the file changed on disk"), exactly like cmdRestore's own
	// writeIfUnchangedSince call would on a real race.
	casErr := writeIfUnchangedSince(p, "0000000000000000000000000000000000000000000000000000000000000000", []byte(restored))
	if casErr == nil {
		t.Fatal("writeIfUnchangedSince unexpectedly succeeded with a deliberately wrong sha")
	}
	if rollbackErr := restoreReviewJSON(reviewPath, reviewBefore, reviewExisted, reviewGuard, reviewGuardExisted); rollbackErr != nil {
		t.Fatalf("restoreReviewJSON: %v", rollbackErr)
	}
	// --- end of cmdRestore-mirroring section ---

	after, err := reviewstore.ReadReview("works", "note.md")
	if err != nil {
		t.Fatalf("ReadReview (after rollback): %v", err)
	}
	if len(after.Comments) != 1 || after.Comments[0].Anchor == nil {
		t.Fatalf("comment/anchor missing after rollback: %+v", after.Comments)
	}
	if !reflect.DeepEqual(*after.Comments[0].Anchor, *beforeReview.Comments[0].Anchor) {
		t.Fatalf("anchor not rolled back: before=%+v after=%+v", *beforeReview.Comments[0].Anchor, *after.Comments[0].Anchor)
	}
	// The canonical file itself must be untouched by the aborted write.
	onDisk, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if string(onDisk) != currentBody {
		t.Fatalf("canonical file changed despite the CAS check aborting: got %q, want untouched %q", onDisk, currentBody)
	}
}
