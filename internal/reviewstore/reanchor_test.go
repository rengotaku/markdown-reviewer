package reviewstore

import (
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
