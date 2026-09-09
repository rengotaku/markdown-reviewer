package reviewstore

import (
	"strings"
	"testing"
)

// resolvedLine is a tiny helper: resolve an anchor and return its 1-indexed
// line, or 0 when orphaned.
func resolvedLine(t *testing.T, content string, a Anchor) int {
	t.Helper()
	lr, ok := ResolveAnchor(content, a)
	if !ok {
		return 0
	}
	return lr[0]
}

func TestReanchor_LineTextRewritten_FollowsToNewLine(t *testing.T) {
	oldBody := "# Title\n\nThe quick brown fox jumps.\n\nAnother paragraph.\n"
	newBody := "# Title\n\nThe quick RED fox leaps high.\n\nAnother paragraph.\n"

	// Anchor targets line 3 of the old body.
	anchor := Anchor{
		HeadingPath: []string{"# Title"},
		Snippet:     "quick brown fox jumps",
		Occurrence:  0,
	}
	if got := resolvedLine(t, oldBody, anchor); got != 3 {
		t.Fatalf("precondition: old anchor should resolve to line 3, got %d", got)
	}
	if _, ok := ResolveAnchor(newBody, anchor); ok {
		t.Fatalf("precondition: anchor should NOT resolve against new body")
	}

	review := Review{Version: 1, Comments: []Comment{
		{ID: "c-001", Scope: "inline", Body: "x", Anchor: &anchor},
	}}
	out, changed := ReanchorReview(review, oldBody, newBody)
	if !changed {
		t.Fatalf("expected changed=true")
	}
	newAnchor := out.Comments[0].Anchor
	if newAnchor == nil {
		t.Fatalf("anchor became nil")
	}
	// The rebuilt anchor must resolve against the new body, at the rewritten line.
	if got := resolvedLine(t, newBody, *newAnchor); got != 3 {
		t.Fatalf("re-anchored comment should resolve to line 3 of new body, got %d (anchor=%+v)", got, *newAnchor)
	}
	if newAnchor.Snippet == anchor.Snippet {
		t.Fatalf("snippet should have been rebuilt from the new line")
	}
}

func TestReanchor_LineDeleted_StaysOrphan(t *testing.T) {
	oldBody := "# Title\n\nDelete me entirely.\n\nKeep this line.\n"
	newBody := "# Title\n\nKeep this line.\n"

	anchor := Anchor{
		HeadingPath: []string{"# Title"},
		Snippet:     "Delete me entirely",
		Occurrence:  0,
	}
	if got := resolvedLine(t, oldBody, anchor); got != 3 {
		t.Fatalf("precondition: old anchor should resolve to line 3, got %d", got)
	}

	review := Review{Version: 1, Comments: []Comment{
		{ID: "c-001", Scope: "inline", Body: "x", Anchor: &anchor},
	}}
	out, changed := ReanchorReview(review, oldBody, newBody)
	if changed {
		t.Fatalf("expected changed=false when the anchored line was deleted")
	}
	// Anchor must be untouched and stay an honest orphan against the new body.
	if out.Comments[0].Anchor.Snippet != "Delete me entirely" {
		t.Fatalf("anchor should be untouched, got %+v", out.Comments[0].Anchor)
	}
	if _, ok := ResolveAnchor(newBody, *out.Comments[0].Anchor); ok {
		t.Fatalf("deleted-line anchor must remain orphan (unresolved) against new body")
	}
}

func TestReanchor_NoBodyChange_AnchorUnchanged(t *testing.T) {
	body := "# Title\n\nStable content here.\n"
	anchor := Anchor{HeadingPath: []string{"# Title"}, Snippet: "Stable content", Occurrence: 0}
	// #287: a fingerprint-less anchor still gets a one-time backfill even
	// when the body is unchanged (see TestReanchor_NoFingerprint_Backfills
	// OnHealthyResolve), so this test now pre-stamps the fingerprint first —
	// otherwise "the body did not change" is not actually the same as "the
	// anchor is already fully healthy", which is what this test means to
	// assert.
	fp, ok := FingerprintAt(body, anchor)
	if !ok {
		t.Fatalf("precondition: FingerprintAt should succeed")
	}
	anchor.LineFingerprint = fp

	review := Review{Version: 1, Comments: []Comment{
		{ID: "c-001", Scope: "inline", Body: "x", Anchor: &anchor},
	}}
	out, changed := ReanchorReview(review, body, body)
	if changed {
		t.Fatalf("expected changed=false when the body did not change")
	}
	if out.Comments[0].Anchor.Snippet != "Stable content" {
		t.Fatalf("anchor should be untouched, got %+v", out.Comments[0].Anchor)
	}
}

func TestReanchor_MultiAnchor_PartialMove(t *testing.T) {
	// Two anchors on one comment: the first line is rewritten (should move),
	// the second is untouched (should stay).
	oldBody := "# Doc\n\nFirst target sentence.\n\nSecond target sentence.\n"
	newBody := "# Doc\n\nFirst target REWRITTEN sentence.\n\nSecond target sentence.\n"

	a0 := Anchor{HeadingPath: []string{"# Doc"}, Snippet: "First target sentence", Occurrence: 0}
	a1 := Anchor{HeadingPath: []string{"# Doc"}, Snippet: "Second target sentence", Occurrence: 0}

	if resolvedLine(t, oldBody, a0) != 3 || resolvedLine(t, oldBody, a1) != 5 {
		t.Fatalf("precondition: old anchors should resolve to lines 3 and 5")
	}
	// a1 still resolves against the new body unchanged.
	if resolvedLine(t, newBody, a1) != 5 {
		t.Fatalf("precondition: second anchor should still resolve at line 5 of new body")
	}

	review := Review{Version: 1, Comments: []Comment{
		{ID: "c-001", Scope: "cross_section", Body: "x", Anchors: []Anchor{a0, a1}},
	}}
	out, changed := ReanchorReview(review, oldBody, newBody)
	if !changed {
		t.Fatalf("expected changed=true (one anchor moved)")
	}
	anchors := out.Comments[0].Anchors
	if len(anchors) != 2 {
		t.Fatalf("expected 2 anchors, got %d", len(anchors))
	}
	// a0 moved: must resolve against new body at line 3.
	if got := resolvedLine(t, newBody, anchors[0]); got != 3 {
		t.Fatalf("first anchor should re-anchor to line 3 of new body, got %d (%+v)", got, anchors[0])
	}
	if anchors[0].Snippet == a0.Snippet {
		t.Fatalf("first anchor snippet should have been rebuilt")
	}
	// a1 untouched: identical to the original.
	if anchors[1].Snippet != a1.Snippet || anchors[1].Occurrence != a1.Occurrence {
		t.Fatalf("second anchor should be untouched, got %+v", anchors[1])
	}
}

func TestReanchor_HeadingInserted_RecomputesHeadingPathAndOccurrence(t *testing.T) {
	// The target line's TEXT is unchanged, but a new "## Beta" heading is
	// inserted just before it. That changes the line's heading stack from
	// "## Alpha" to "## Beta", so the original anchor (heading_path ## Alpha)
	// no longer resolves and must be rebuilt with the new heading_path.
	oldBody := "# Root\n\n## Alpha\n\nShared body line.\n\nUnique tail line.\n"
	newBody := "# Root\n\n## Alpha\n\n## Beta\n\nShared body line.\n\nUnique tail line.\n"

	anchor := Anchor{
		HeadingPath: []string{"# Root", "## Alpha"},
		Snippet:     "Shared body line",
		Occurrence:  0,
	}
	if got := resolvedLine(t, oldBody, anchor); got != 5 {
		t.Fatalf("precondition: old anchor should resolve to line 5, got %d", got)
	}
	// The moved-under-## Beta line breaks the heading_path suffix match, so the
	// original anchor must NOT resolve against the new body.
	if _, ok := ResolveAnchor(newBody, anchor); ok {
		t.Fatalf("precondition: anchor should not resolve against new body (heading_path changed)")
	}

	review := Review{Version: 1, Comments: []Comment{
		{ID: "c-001", Scope: "inline", Body: "x", Anchor: &anchor},
	}}
	out, changed := ReanchorReview(review, oldBody, newBody)
	if !changed {
		t.Fatalf("expected changed=true")
	}
	na := out.Comments[0].Anchor
	// Heading path must reflect the newly inserted "## Beta" section.
	if len(na.HeadingPath) != 2 || na.HeadingPath[0] != "# Root" || na.HeadingPath[1] != "## Beta" {
		t.Fatalf("heading_path not recomputed under new section, got %v", na.HeadingPath)
	}
	// occurrence must be recomputed for the new body (0 here — first line under
	// its heading path that contains the snippet).
	if na.Occurrence != 0 {
		t.Fatalf("occurrence not recomputed, got %d", na.Occurrence)
	}
	// It must resolve to the "Shared body line" line in the new body (line 7).
	if got := resolvedLine(t, newBody, *na); got != 7 {
		t.Fatalf("re-anchored comment should resolve to line 7 of new body, got %d (%+v)", got, *na)
	}
}

func TestReanchor_GlobalCommentUntouched(t *testing.T) {
	oldBody := "# Title\n\nabc\n"
	newBody := "# Title\n\nxyz\n"
	review := Review{Version: 1, Comments: []Comment{
		{ID: "c-001", Scope: "global", Body: "file-wide"},
	}}
	out, changed := ReanchorReview(review, oldBody, newBody)
	if changed {
		t.Fatalf("global comment (no anchors) should not trigger a change")
	}
	if out.Comments[0].Anchor != nil || len(out.Comments[0].Anchors) != 0 {
		t.Fatalf("global comment anchors should stay empty")
	}
}

func TestReanchorOnSave_PersistsMovedAnchor(t *testing.T) {
	withTempStore(t)
	const root, rel = "rooms", "doc.md"
	if err := Ingest(root, rel); err != nil {
		t.Fatalf("Ingest: %v", err)
	}
	oldBody := "# Title\n\nThe original wording here.\n"
	newBody := "# Title\n\nThe UPDATED wording here now.\n"

	anchor := Anchor{HeadingPath: []string{"# Title"}, Snippet: "original wording here", Occurrence: 0}
	if _, err := AddComment(root, rel, Comment{
		Scope: "inline", Body: "x", Anchor: &anchor,
	}); err != nil {
		t.Fatalf("AddComment: %v", err)
	}

	changed, err := ReanchorOnSave(root, rel, oldBody, newBody)
	if err != nil {
		t.Fatalf("ReanchorOnSave: %v", err)
	}
	if !changed {
		t.Fatalf("expected changed=true")
	}

	// Persisted: reloading review.json shows the rebuilt anchor resolving.
	r, err := ReadReview(root, rel)
	if err != nil {
		t.Fatalf("ReadReview: %v", err)
	}
	if len(r.Comments) != 1 || r.Comments[0].Anchor == nil {
		t.Fatalf("unexpected review after reanchor: %+v", r.Comments)
	}
	if got := resolvedLine(t, newBody, *r.Comments[0].Anchor); got != 3 {
		t.Fatalf("persisted anchor should resolve to line 3 of new body, got %d (%+v)", got, *r.Comments[0].Anchor)
	}
}

// TestReanchor_NonUniqueSnippet_ReorderedRows_FollowsFingerprint is the #287
// regression: a snippet that repeats across many lines under the same
// heading (a table's status column) used to let ResolveAnchor's
// Occurrence-th-match rule silently "succeed" against a reordered row,
// pointing the comment at someone else's row. With a fingerprint recorded,
// reanchorOne must detect the mismatch and follow the anchor to the row it
// was actually about.
func TestReanchor_NonUniqueSnippet_ReorderedRows_FollowsFingerprint(t *testing.T) {
	oldBody := "# Doc\n\n" +
		"| No | 担当 | 状態 |\n" +
		"|----|------|------|\n" +
		"| 1 | A | 未対応 |\n" +
		"| 2 | B | 未対応 |\n" +
		"| 3 | C | 未対応 |\n"
	// Row 1 (A) moves to the end.
	newBody := "# Doc\n\n" +
		"| No | 担当 | 状態 |\n" +
		"|----|------|------|\n" +
		"| 2 | B | 未対応 |\n" +
		"| 3 | C | 未対応 |\n" +
		"| 1 | A | 未対応 |\n"

	anchor := Anchor{HeadingPath: []string{"# Doc"}, Snippet: "未対応", Occurrence: 0}
	if got := resolvedLine(t, oldBody, anchor); got != 5 {
		t.Fatalf("precondition: anchor should resolve to line 5 (A's row) in old body, got %d", got)
	}
	fp, ok := FingerprintAt(oldBody, anchor)
	if !ok {
		t.Fatalf("precondition: FingerprintAt should succeed on old body")
	}
	anchor.LineFingerprint = fp

	// Precondition establishing the bug this guards against: without the
	// fingerprint, Occurrence=0 under the new body resolves to line 5 too —
	// but that is now B's row, not A's.
	newRange, ok := ResolveAnchor(newBody, Anchor{HeadingPath: anchor.HeadingPath, Snippet: anchor.Snippet, Occurrence: anchor.Occurrence})
	if !ok || newRange[0] != 5 {
		t.Fatalf("precondition: naive resolve should silently land on line 5 (B's row) in new body, got %v ok=%v", newRange, ok)
	}

	review := Review{Version: 1, Comments: []Comment{
		{ID: "c-001", Scope: "inline", Body: "x", Anchor: &anchor},
	}}
	out, changed := ReanchorReview(review, oldBody, newBody)
	if !changed {
		t.Fatalf("expected changed=true (fingerprint mismatch should trigger a rebuild)")
	}
	na := out.Comments[0].Anchor
	if na.Orphan {
		t.Fatalf("A's row still exists in the new body; anchor should be re-anchored, not orphaned: %+v", na)
	}
	if got := resolvedLine(t, newBody, *na); got != 7 {
		t.Fatalf("re-anchored comment should resolve to line 7 (A's row) of new body, got %d (%+v)", got, *na)
	}
	// Snippet must be preserved (not rebuilt to the whole stripped line, e.g.
	// "| 1 | A | 未対応 |"): the frontend resolves anchors against a table
	// row's per-cell text (frontend/src/utils/pmAnchor.ts extractAnchorBlocks),
	// which never carries the row's pipe characters, so a pipe-bearing
	// Snippet would resolve correctly here on the backend yet match no block
	// at all in the editor (dead highlight / "対象" jump).
	if na.Snippet != anchor.Snippet {
		t.Fatalf("Snippet should be preserved as %q for frontend compatibility, got %q", anchor.Snippet, na.Snippet)
	}
	// Occurrence must be recomputed for the moved position (line 7 is now
	// the 2nd match under "# Doc", i.e. occurrence 2 — after B's and C's
	// rows).
	if na.Occurrence != 2 {
		t.Fatalf("Occurrence should be recomputed for the new position, want 2 got %d", na.Occurrence)
	}
}

// TestReanchor_NonUniqueSnippet_MovedAndTextChanged_CannotPreserveSnippet
// covers the case rebuildPreservingSnippet cannot handle: the target row not
// only moves but its own text changes too, so the original Snippet no longer
// occurs anywhere with that exact recorded line text — findLineByFingerprint
// (an exact full-line match) finds nothing, and the old->new LCS lineMap
// cannot help either since a reordered line is a pure delete paired with a
// pure insert elsewhere, not a same-position edit. There is no way to relocate
// the original comment's target with any confidence, so the honest outcome
// is Orphan (the Snippet is preserved on the orphaned anchor so a human can
// still see what it used to point at) — silently guessing a rebuilt anchor
// from an unrelated line would be worse.
func TestReanchor_NonUniqueSnippet_MovedAndTextChanged_CannotPreserveSnippet(t *testing.T) {
	oldBody := "# Doc\n\n" +
		"| No | 担当 | 状態 |\n" +
		"|----|------|------|\n" +
		"| 1 | A | 未対応 |\n" +
		"| 2 | B | 未対応 |\n" +
		"| 3 | C | 未対応 |\n"
	// A's row moves to the end AND its status changes to "対応中" — the
	// original "未対応" snippet no longer occurs on that line at all, and the
	// row's full old text ("| 1 | A | 未対応 |") no longer exists anywhere.
	newBody := "# Doc\n\n" +
		"| No | 担当 | 状態 |\n" +
		"|----|------|------|\n" +
		"| 2 | B | 未対応 |\n" +
		"| 3 | C | 未対応 |\n" +
		"| 1 | A | 対応中 |\n"

	anchor := Anchor{HeadingPath: []string{"# Doc"}, Snippet: "未対応", Occurrence: 0}
	fp, ok := FingerprintAt(oldBody, anchor)
	if !ok {
		t.Fatalf("precondition: FingerprintAt should succeed on old body")
	}
	anchor.LineFingerprint = fp
	originalSnippet := anchor.Snippet

	review := Review{Version: 1, Comments: []Comment{
		{ID: "c-001", Scope: "inline", Body: "x", Anchor: &anchor},
	}}
	out, changed := ReanchorReview(review, oldBody, newBody)
	if !changed {
		t.Fatalf("expected changed=true (flagging Orphan counts as a change)")
	}
	na := out.Comments[0].Anchor
	if !na.Orphan {
		t.Fatalf("expected Orphan=true: the row's exact old text is gone (moved AND edited), so no relocation can be trusted, got %+v", na)
	}
	if na.Snippet != originalSnippet {
		t.Fatalf("Snippet should be preserved on an orphaned anchor so a human can see what it pointed at, got %q", na.Snippet)
	}
	if _, ok := ResolveAnchor(newBody, *na); ok {
		t.Fatalf("Orphan anchor must not resolve via ResolveAnchor")
	}
}

// TestReanchor_NonUniqueSnippet_TargetRowDeleted_BecomesOrphan is the delete
// side of the same bug: the row the comment was about is removed entirely,
// but other rows with the identical snippet remain. Without the fingerprint
// check, ResolveAnchor's Occurrence-th-match rule "succeeds" against one of
// the surviving rows. reanchorOne must recognize this as unrecoverable and
// mark the anchor Orphan (not silently keep pointing at a stranger's row).
func TestReanchor_NonUniqueSnippet_TargetRowDeleted_BecomesOrphan(t *testing.T) {
	oldBody := "# Doc\n\n" +
		"| No | 担当 | 状態 |\n" +
		"|----|------|------|\n" +
		"| 1 | A | 未対応 |\n" +
		"| 2 | B | 未対応 |\n" +
		"| 3 | C | 未対応 |\n"
	// A's row (line 5) is deleted; B's and C's rows survive unchanged.
	newBody := "# Doc\n\n" +
		"| No | 担当 | 状態 |\n" +
		"|----|------|------|\n" +
		"| 2 | B | 未対応 |\n" +
		"| 3 | C | 未対応 |\n"

	anchor := Anchor{HeadingPath: []string{"# Doc"}, Snippet: "未対応", Occurrence: 0}
	if got := resolvedLine(t, oldBody, anchor); got != 5 {
		t.Fatalf("precondition: anchor should resolve to line 5 (A's row) in old body, got %d", got)
	}
	fp, ok := FingerprintAt(oldBody, anchor)
	if !ok {
		t.Fatalf("precondition: FingerprintAt should succeed on old body")
	}
	anchor.LineFingerprint = fp
	originalSnippet := anchor.Snippet

	review := Review{Version: 1, Comments: []Comment{
		{ID: "c-001", Scope: "inline", Body: "x", Anchor: &anchor},
	}}
	out, changed := ReanchorReview(review, oldBody, newBody)
	if !changed {
		t.Fatalf("expected changed=true (silent mismatch must be flagged even though it 'resolves')")
	}
	na := out.Comments[0].Anchor
	if !na.Orphan {
		t.Fatalf("expected anchor to be flagged Orphan, got %+v", na)
	}
	if na.Snippet != originalSnippet {
		t.Fatalf("Snippet should be preserved on an orphaned anchor so a human can see what it pointed at, got %q", na.Snippet)
	}
	if _, ok := ResolveAnchor(newBody, *na); ok {
		t.Fatalf("Orphan anchor must not resolve via ResolveAnchor")
	}
}

// TestReanchor_OrphanRecoversWhenTargetLineIsRestored is the codex-caught P2
// regression: ResolveAnchor unconditionally rejects Orphan:true (by design,
// for every other caller — see TestResolveAnchor_OrphanFlagShortCircuits and
// TestResolveAnchorForDisplay_OrphanFlagIsNotRecoveredByFallback), but that
// same rejection, if applied to reanchorOne's own internal checks, would
// mean an anchor can never recover once flagged: ResolveAnchor(new, a) and
// ResolveAnchor(old, a) both refuse to look at it, so the anchor would be
// stuck Orphan forever even after the row it pointed to comes back (e.g. an
// `mr restore` that undoes the deletion). This continues directly from
// TestReanchor_NonUniqueSnippet_TargetRowDeleted_BecomesOrphan: its Orphan
// output becomes this test's input, and the deleted row is restored.
func TestReanchor_OrphanRecoversWhenTargetLineIsRestored(t *testing.T) {
	deletedBody := "# Doc\n\n" +
		"| No | 担当 | 状態 |\n" +
		"|----|------|------|\n" +
		"| 2 | B | 未対応 |\n" +
		"| 3 | C | 未対応 |\n"
	// A's row (originally line 5) is restored exactly as it was.
	restoredBody := "# Doc\n\n" +
		"| No | 担当 | 状態 |\n" +
		"|----|------|------|\n" +
		"| 1 | A | 未対応 |\n" +
		"| 2 | B | 未対応 |\n" +
		"| 3 | C | 未対応 |\n"

	orphaned := Anchor{
		HeadingPath:     []string{"# Doc"},
		Snippet:         "未対応",
		Occurrence:      0,
		LineFingerprint: "| 1 | A | 未対応 |", // set by the earlier deletion's reanchor
		Orphan:          true,
	}
	if _, ok := ResolveAnchor(deletedBody, orphaned); ok {
		t.Fatalf("precondition: Orphan anchor must not resolve against the pre-restore body")
	}

	review := Review{Version: 1, Comments: []Comment{
		{ID: "c-001", Scope: "inline", Body: "x", Anchor: &orphaned},
	}}
	out, changed := ReanchorReview(review, deletedBody, restoredBody)
	if !changed {
		t.Fatalf("expected changed=true (recovering from Orphan is a change)")
	}
	na := out.Comments[0].Anchor
	if na.Orphan {
		t.Fatalf("expected Orphan to be cleared once the original target line is back, got %+v", na)
	}
	if got := resolvedLine(t, restoredBody, *na); got != 5 {
		t.Fatalf("recovered anchor should resolve to line 5 (A's restored row), got %d (%+v)", got, *na)
	}
}

// TestReanchor_OrphanStaysOrphan_WhenUnrelatedEditResolvesToWrongOldLine is
// the third-round codex P1: the diff-recovery path (step 1) must not trust
// oldIdx blindly. Once a row is deleted and its anchor is Orphan:true, an
// unrelated edit elsewhere in the document still makes
// ResolveAnchor(oldCanonical, probe) "succeed" — the Snippet is non-unique,
// so probe (Orphan forced false for the internal check) matches some
// surviving, unrelated row B purely because B also contains the Snippet.
// Before this fix, that oldIdx was trusted outright: lineMap mapped B's
// unchanged position straight through, rebuildPreservingSnippet "recovered"
// onto B, and Orphan/LineFingerprint were permanently overwritten with B's
// identity — with no way back afterwards. The fix requires oldIdx's own
// fingerprint to match the anchor's recorded one before trusting it; here it
// does not (B's fingerprint, not A's), so the diff path must be disqualified
// and — since the fingerprint search also finds nothing (A's exact line is
// gone from both bodies) — the anchor must stay untouched: Orphan:true,
// Snippet and LineFingerprint exactly as before.
func TestReanchor_OrphanStaysOrphan_WhenUnrelatedEditResolvesToWrongOldLine(t *testing.T) {
	// A's row (line 5) was already deleted in an earlier save; only B's and
	// C's rows remain. An unrelated preamble line is about to be edited.
	oldBody := "# Doc\n\nSee the table below.\n\n" +
		"| No | 担当 | 状態 |\n" +
		"|----|------|------|\n" +
		"| 2 | B | 未対応 |\n" +
		"| 3 | C | 未対応 |\n"
	newBody := "# Doc\n\nSee the table below (updated wording).\n\n" +
		"| No | 担当 | 状態 |\n" +
		"|----|------|------|\n" +
		"| 2 | B | 未対応 |\n" +
		"| 3 | C | 未対応 |\n"

	orphaned := Anchor{
		HeadingPath:     []string{"# Doc"},
		Snippet:         "未対応",
		Occurrence:      0,
		LineFingerprint: "| 1 | A | 未対応 |", // A's row, gone from both bodies
		Orphan:          true,
	}
	// Precondition establishing the bug: probe (Orphan forced false)
	// resolves against oldCanonical, but only by matching B's unrelated,
	// surviving row — not A's.
	probe := orphaned
	probe.Orphan = false
	if _, ok := ResolveAnchor(oldBody, probe); !ok {
		t.Fatalf("precondition: probe should resolve against oldBody (onto B's row)")
	}
	if oldFP, ok := FingerprintAt(oldBody, probe); !ok || oldFP == orphaned.LineFingerprint {
		t.Fatalf("precondition: the line probe resolves to must NOT match the anchor's recorded fingerprint, got %q ok=%v", oldFP, ok)
	}

	review := Review{Version: 1, Comments: []Comment{
		{ID: "c-001", Scope: "inline", Body: "x", Anchor: &orphaned},
	}}
	out, _ := ReanchorReview(review, oldBody, newBody)
	na := out.Comments[0].Anchor
	if !na.Orphan {
		t.Fatalf("expected Orphan to remain true; an unrelated edit must not clear it via a mismatched old-line resolve, got %+v", na)
	}
	if na.LineFingerprint != orphaned.LineFingerprint {
		t.Fatalf("LineFingerprint must not be overwritten by an untrustworthy diff-recovery, got %q want %q", na.LineFingerprint, orphaned.LineFingerprint)
	}
	if na.Snippet != orphaned.Snippet {
		t.Fatalf("Snippet must be preserved, got %q want %q", na.Snippet, orphaned.Snippet)
	}
	if _, ok := ResolveAnchor(newBody, *na); ok {
		t.Fatalf("Orphan anchor must not resolve via ResolveAnchor")
	}
}

// TestReanchor_NoFingerprint_BackfillsOnHealthyResolve is the back-compat
// case: pre-#287 data has no LineFingerprint. As long as the anchor still
// resolves, its Snippet/HeadingPath/Occurrence must be left untouched (same
// behavior as before this feature), but the resolved line's fingerprint
// should be backfilled so the anchor is protected against a silent move on
// the *next* save.
func TestReanchor_NoFingerprint_BackfillsOnHealthyResolve(t *testing.T) {
	body := "# Title\n\nStable content here.\n"
	anchor := Anchor{HeadingPath: []string{"# Title"}, Snippet: "Stable content", Occurrence: 0}
	if anchor.LineFingerprint != "" {
		t.Fatalf("precondition: anchor should start with no fingerprint")
	}

	review := Review{Version: 1, Comments: []Comment{
		{ID: "c-001", Scope: "inline", Body: "x", Anchor: &anchor},
	}}
	out, changed := ReanchorReview(review, body, body)
	if !changed {
		t.Fatalf("expected changed=true (fingerprint backfill counts as a change)")
	}
	na := out.Comments[0].Anchor
	if na.Snippet != anchor.Snippet || na.Occurrence != anchor.Occurrence {
		t.Fatalf("Snippet/Occurrence must be untouched by a backfill-only change, got %+v", na)
	}
	if na.HeadingPath[0] != anchor.HeadingPath[0] {
		t.Fatalf("HeadingPath must be untouched by a backfill-only change, got %+v", na.HeadingPath)
	}
	if na.LineFingerprint == "" {
		t.Fatalf("expected LineFingerprint to be backfilled, got empty")
	}
	wantFP, ok := FingerprintAt(body, anchor)
	if !ok || na.LineFingerprint != wantFP {
		t.Fatalf("backfilled fingerprint should match the resolved line, got %q want %q (ok=%v)", na.LineFingerprint, wantFP, ok)
	}
}

// TestReanchor_FingerprintMatches_NoChange confirms the steady state once a
// fingerprint has been recorded and nothing moved: reanchorOne must report
// changed=false so an unrelated save does not keep rewriting review.json.
func TestReanchor_FingerprintMatches_NoChange(t *testing.T) {
	body := "# Title\n\nStable content here.\n"
	anchor := Anchor{HeadingPath: []string{"# Title"}, Snippet: "Stable content", Occurrence: 0}
	fp, ok := FingerprintAt(body, anchor)
	if !ok {
		t.Fatalf("precondition: FingerprintAt should succeed")
	}
	anchor.LineFingerprint = fp

	review := Review{Version: 1, Comments: []Comment{
		{ID: "c-001", Scope: "inline", Body: "x", Anchor: &anchor},
	}}
	out, changed := ReanchorReview(review, body, body)
	if changed {
		t.Fatalf("expected changed=false once the fingerprint already matches, got %+v", out.Comments[0].Anchor)
	}
}

// TestReanchor_MultiAnchor_NonUniqueSnippet_OneMovesOneOrphans exercises the
// Anchors (cross_section / multi-line) path with the same non-unique-snippet
// scenario: one anchor's target row is reordered (should follow via
// fingerprint), the other's target row is deleted (should become Orphan).
// TestReanchor_SameRow_UnrelatedCellEdited_KeepsOriginalSnippet is the P2
// regression codex caught: the row does not move (so the fingerprint search
// finds nothing — the exact old line text is gone), but the diff still maps
// old->new via lineMap because the line was edited in place. Before this fix,
// that path always went straight to rebuildAt (whole line as Snippet); now it
// tries rebuildPreservingSnippet first, so editing an unrelated cell (担当)
// on the same row must not regress the anchor's own cell's ("状態") snippet
// to a pipe-bearing whole-line string the frontend's per-cell matching can
// never resolve.
// TestReanchor_EditedLine_PrefersOwnLineOverDuplicateInAnotherSection is the
// codex-caught regression from trying the fingerprint-based document-wide
// search *before* the local diff: two sections carry an identical line
// ("foo target" under both "# A" and "# B"); the anchor is scoped to "# A" by
// heading_path and its line there is edited in place ("foo target" ->
// "foo target extra", still containing the snippet, still under "# A"). The
// old->new diff maps that edit at the same relative position, so the anchor
// should simply follow its own line. A fingerprint-first search would instead
// find "# B"'s untouched line (an exact full-text match of the old
// fingerprint) and silently reattach the comment there, rewriting
// heading_path to "# B" — before this fix, that is exactly what happened.
func TestReanchor_EditedLine_PrefersOwnLineOverDuplicateInAnotherSection(t *testing.T) {
	oldBody := "# A\n\nfoo target\n\n# B\n\nfoo target\n"
	// Only A's line is edited; B's identical line is untouched.
	newBody := "# A\n\nfoo target extra\n\n# B\n\nfoo target\n"

	anchor := Anchor{HeadingPath: []string{"# A"}, Snippet: "foo target", Occurrence: 0}
	if got := resolvedLine(t, oldBody, anchor); got != 3 {
		t.Fatalf("precondition: anchor should resolve to line 3 (under # A) in old body, got %d", got)
	}
	fp, ok := FingerprintAt(oldBody, anchor)
	if !ok {
		t.Fatalf("precondition: FingerprintAt should succeed on old body")
	}
	anchor.LineFingerprint = fp

	// Precondition establishing the bug this guards against: a document-wide
	// search for the *old* fingerprint ("foo target") would find B's
	// unchanged line, not A's edited one.
	if newIdx, found := findLineByFingerprint(strings.Split(newBody, "\n"), fp); !found || newIdx != 6 {
		t.Fatalf("precondition: findLineByFingerprint should land on B's line (index 6), got %d found=%v", newIdx, found)
	}

	review := Review{Version: 1, Comments: []Comment{
		{ID: "c-001", Scope: "inline", Body: "x", Anchor: &anchor},
	}}
	out, changed := ReanchorReview(review, oldBody, newBody)
	if !changed {
		t.Fatalf("expected changed=true (the line's fingerprint no longer matches)")
	}
	na := out.Comments[0].Anchor
	if na.Orphan {
		t.Fatalf("A's line still exists (edited, not deleted); must not be orphaned: %+v", na)
	}
	if len(na.HeadingPath) != 1 || na.HeadingPath[0] != "# A" {
		t.Fatalf("heading_path must stay under # A (the anchor's own edited line), got %v", na.HeadingPath)
	}
	if got := resolvedLine(t, newBody, *na); got != 3 {
		t.Fatalf("should follow its own line's edit to line 3 (# A), not B's untouched line 7, got %d (%+v)", got, *na)
	}
}

func TestReanchor_SameRow_UnrelatedCellEdited_KeepsOriginalSnippet(t *testing.T) {
	oldBody := "# Doc\n\n" +
		"| No | 担当 | 状態 |\n" +
		"|----|------|------|\n" +
		"| 1 | A | 未対応 |\n" +
		"| 2 | B | 未対応 |\n"
	// Row 1 stays in place, but its 担当 cell changes A -> B.
	newBody := "# Doc\n\n" +
		"| No | 担当 | 状態 |\n" +
		"|----|------|------|\n" +
		"| 1 | B | 未対応 |\n" +
		"| 2 | B | 未対応 |\n"

	anchor := Anchor{HeadingPath: []string{"# Doc"}, Snippet: "未対応", Occurrence: 0}
	fp, ok := FingerprintAt(oldBody, anchor)
	if !ok {
		t.Fatalf("precondition: FingerprintAt should succeed on old body")
	}
	anchor.LineFingerprint = fp

	review := Review{Version: 1, Comments: []Comment{
		{ID: "c-001", Scope: "inline", Body: "x", Anchor: &anchor},
	}}
	out, changed := ReanchorReview(review, oldBody, newBody)
	if !changed {
		t.Fatalf("expected changed=true (fingerprint no longer matches the edited row)")
	}
	na := out.Comments[0].Anchor
	if na.Orphan {
		t.Fatalf("row 1 still exists and still contains the snippet; must not be orphaned: %+v", na)
	}
	if na.Snippet != anchor.Snippet {
		t.Fatalf("Snippet should be preserved as %q (frontend resolves per-cell, not per-row), got %q", anchor.Snippet, na.Snippet)
	}
	if got := resolvedLine(t, newBody, *na); got != 5 {
		t.Fatalf("should still resolve to line 5 (row 1), got %d (%+v)", got, *na)
	}
	wantFP, ok := FingerprintAt(newBody, *na)
	if !ok || na.LineFingerprint != wantFP {
		t.Fatalf("LineFingerprint should be refreshed to the edited row's new fingerprint, got %q want %q (ok=%v)", na.LineFingerprint, wantFP, ok)
	}
}

func TestReanchor_MultiAnchor_NonUniqueSnippet_OneMovesOneOrphans(t *testing.T) {
	oldBody := "# Doc\n\n" +
		"| No | 担当 | 状態 |\n" +
		"|----|------|------|\n" +
		"| 1 | A | 未対応 |\n" +
		"| 2 | B | 未対応 |\n" +
		"| 3 | C | 未対応 |\n"
	// A's row (occurrence 0, was line 5) moves to the end; B's row
	// (occurrence 1, was line 6) is deleted.
	newBody := "# Doc\n\n" +
		"| No | 担当 | 状態 |\n" +
		"|----|------|------|\n" +
		"| 3 | C | 未対応 |\n" +
		"| 1 | A | 未対応 |\n"

	aA := Anchor{HeadingPath: []string{"# Doc"}, Snippet: "未対応", Occurrence: 0}
	aB := Anchor{HeadingPath: []string{"# Doc"}, Snippet: "未対応", Occurrence: 1}
	fpA, okA := FingerprintAt(oldBody, aA)
	fpB, okB := FingerprintAt(oldBody, aB)
	if !okA || !okB {
		t.Fatalf("precondition: both anchors should fingerprint against old body")
	}
	aA.LineFingerprint = fpA
	aB.LineFingerprint = fpB

	review := Review{Version: 1, Comments: []Comment{
		{ID: "c-001", Scope: "cross_section", Body: "x", Anchors: []Anchor{aA, aB}},
	}}
	out, changed := ReanchorReview(review, oldBody, newBody)
	if !changed {
		t.Fatalf("expected changed=true")
	}
	anchors := out.Comments[0].Anchors
	if len(anchors) != 2 {
		t.Fatalf("expected 2 anchors, got %d", len(anchors))
	}
	if anchors[0].Orphan {
		t.Fatalf("A's row still exists; first anchor should be re-anchored, not orphaned: %+v", anchors[0])
	}
	if got := resolvedLine(t, newBody, anchors[0]); got != 6 {
		t.Fatalf("first anchor should re-anchor to line 6 (A's row) of new body, got %d (%+v)", got, anchors[0])
	}
	if !anchors[1].Orphan {
		t.Fatalf("B's row was deleted; second anchor should be orphaned, got %+v", anchors[1])
	}
}

func TestReanchorOnSave_NotIngestedNoOp(t *testing.T) {
	withTempStore(t)
	changed, err := ReanchorOnSave("rooms", "draft.md", "old\n", "new\n")
	if err != nil {
		t.Fatalf("ReanchorOnSave on draft should not error: %v", err)
	}
	if changed {
		t.Fatalf("expected no-op (changed=false) for a non-ingested file")
	}
}
