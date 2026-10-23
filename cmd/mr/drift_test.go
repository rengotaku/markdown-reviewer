package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"markdown-reviewer/internal/reviewstore"
)

// setupDoc ingests a fresh file under root "works", appends its body as the
// r-001 baseline revision, and stamps last_read.json to point at it — the
// state `mr comments` leaves behind after a first successful read, which is
// what every drift test below starts from.
func setupDoc(t *testing.T, root, body string) (rel string) {
	t.Helper()
	rel = "doc.md"
	p := filepath.Join(root, rel)
	if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := reviewstore.Ingest("works", rel); err != nil {
		t.Fatalf("Ingest: %v", err)
	}
	rev, _, err := reviewstore.AppendRevision("works", rel, "human", body)
	if err != nil {
		t.Fatalf("AppendRevision: %v", err)
	}
	if err := reviewstore.RecordLastRead("works", rel, reviewstore.ShortSha(body), rev.ID); err != nil {
		t.Fatalf("RecordLastRead: %v", err)
	}
	return rel
}

func TestDriftBanner_NoPriorLastRead_Empty(t *testing.T) {
	root := withRoots(t)
	t.Setenv("REVIEWER_CONFIG_DIR", t.TempDir())
	p := filepath.Join(root, "note.md")
	if err := os.WriteFile(p, []byte("v1"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := reviewstore.Ingest("works", "note.md"); err != nil {
		t.Fatalf("Ingest: %v", err)
	}
	banner, err := driftBanner("works", "note.md", nil, "v1")
	if err != nil {
		t.Fatalf("driftBanner: %v", err)
	}
	if banner != "" {
		t.Fatalf("banner = %q, want empty (no last_read recorded yet)", banner)
	}
}

func TestDriftBanner_UnchangedBody_Empty(t *testing.T) {
	root := withRoots(t)
	t.Setenv("REVIEWER_CONFIG_DIR", t.TempDir())
	body := "# Title\n\nSome content.\n"
	rel := setupDoc(t, root, body)

	banner, err := driftBanner("works", rel, nil, body)
	if err != nil {
		t.Fatalf("driftBanner: %v", err)
	}
	if banner != "" {
		t.Fatalf("banner = %q, want empty (body unchanged since last_read)", banner)
	}
}

func TestDriftBanner_ChangedBody_ReportsStatsAndDiffHint(t *testing.T) {
	root := withRoots(t)
	t.Setenv("REVIEWER_CONFIG_DIR", t.TempDir())
	body := "# Title\n\nline one.\nline two.\n"
	rel := setupDoc(t, root, body)

	if _, _, err := reviewstore.AppendRevision("works", rel, "external", body+"line three.\n"); err != nil {
		t.Fatalf("AppendRevision: %v", err)
	}
	newBody := body + "line three.\nline four.\n"

	banner, err := driftBanner("works", rel, nil, newBody)
	if err != nil {
		t.Fatalf("driftBanner: %v", err)
	}
	if !strings.Contains(banner, "本文が変わっています") {
		t.Errorf("banner missing header: %q", banner)
	}
	if !strings.Contains(banner, "1 リビジョン（external）") {
		t.Errorf("banner missing revision count/authors: %q", banner)
	}
	if !strings.Contains(banner, "+2 -0 行") {
		t.Errorf("banner missing +/- stats: %q", banner)
	}
	if !strings.Contains(banner, "mr diff "+rel+" --since-last-read") {
		t.Errorf("banner missing diff hint: %q", banner)
	}
}

func TestDriftBanner_BaselineEvicted_ReportsLostBaseline(t *testing.T) {
	root := withRoots(t)
	t.Setenv("REVIEWER_CONFIG_DIR", t.TempDir())
	body := "v0"
	rel := setupDoc(t, root, body)

	// last_read points at a revision id that does not exist in history.jsonl
	// (simulating MaxRevisions eviction).
	if err := reviewstore.RecordLastRead("works", rel, reviewstore.ShortSha(body), "r-999"); err != nil {
		t.Fatalf("RecordLastRead: %v", err)
	}

	banner, err := driftBanner("works", rel, nil, "v1")
	if err != nil {
		t.Fatalf("driftBanner: %v", err)
	}
	if !strings.Contains(banner, "基準版が履歴から失われています") {
		t.Errorf("banner = %q, want the lost-baseline message", banner)
	}
	if strings.Contains(banner, "行\n") {
		t.Errorf("banner should not report +/- stats without a baseline: %q", banner)
	}
}

// TestDriftBanner_ImpactedComments covers the issue's classification split:
// an anchor whose text still exists somewhere in the baseline (only its
// position moved) must not be reported, one that no longer resolves at all
// is "位置不明", and one that resolves to genuinely rewritten text is
// "アンカー行が変更".
func TestDriftBanner_ImpactedComments(t *testing.T) {
	root := withRoots(t)
	t.Setenv("REVIEWER_CONFIG_DIR", t.TempDir())
	body := "# Title\n\nAlpha line.\nBravo line.\nCharlie line.\n"
	rel := setupDoc(t, root, body)

	moved, err := reviewstore.AddComment("works", rel, reviewstore.Comment{
		Scope: "inline", Status: reviewstore.StatusOpen,
		Anchor: &reviewstore.Anchor{HeadingPath: []string{"# Title"}, Snippet: "Alpha line", Occurrence: 0},
	})
	if err != nil {
		t.Fatalf("AddComment moved: %v", err)
	}
	gone, err := reviewstore.AddComment("works", rel, reviewstore.Comment{
		Scope: "inline", Status: reviewstore.StatusOpen,
		Anchor: &reviewstore.Anchor{HeadingPath: []string{"# Title"}, Snippet: "Bravo line", Occurrence: 0},
	})
	if err != nil {
		t.Fatalf("AddComment gone: %v", err)
	}
	rewritten, err := reviewstore.AddComment("works", rel, reviewstore.Comment{
		Scope: "inline", Status: reviewstore.StatusOpen,
		Anchor: &reviewstore.Anchor{HeadingPath: []string{"# Title"}, Snippet: "Charlie line", Occurrence: 0},
	})
	if err != nil {
		t.Fatalf("AddComment rewritten: %v", err)
	}

	// Alpha line: pushed down by an insertion above it — position moves, text
	// does not. Bravo line: deleted outright. Charlie line: its own text
	// rewritten in place.
	newBody := "# Title\n\nInserted line.\nAlpha line.\nCharlie line CHANGED.\n"
	if wErr := os.WriteFile(filepath.Join(root, rel), []byte(newBody), 0o644); wErr != nil {
		t.Fatal(wErr)
	}

	comments := []reviewstore.Comment{}
	for _, c := range []struct {
		id string
	}{{moved.ID}, {gone.ID}, {rewritten.ID}} {
		cm, ok, lErr := lookupComment(rel, c.id)
		if lErr != nil || !ok {
			t.Fatalf("lookupComment(%s): ok=%v err=%v", c.id, ok, lErr)
		}
		comments = append(comments, cm)
	}

	banner, err := driftBanner("works", rel, comments, newBody)
	if err != nil {
		t.Fatalf("driftBanner: %v", err)
	}
	if strings.Contains(banner, moved.ID) {
		t.Errorf("moved-only comment %s must not be reported as impacted: %q", moved.ID, banner)
	}
	if !strings.Contains(banner, gone.ID+" 位置不明") {
		t.Errorf("deleted-line comment %s should be 位置不明: %q", gone.ID, banner)
	}
	if !strings.Contains(banner, rewritten.ID+" アンカー行が変更") {
		t.Errorf("rewritten-line comment %s should be アンカー行が変更: %q", rewritten.ID, banner)
	}
}

// TestDriftBanner_ResolvableViaDisplayFallback_NotFlagged is the coordinator's
// e2e regression: real API-created comments store heading_path as rendered
// text (no leading "#", per the "描画後テキスト" anchor contract — see
// CLAUDE.md), which never matches headingStacks' "# " + text stack entries
// under plain ResolveAnchor. Such an anchor only ever resolves through
// ResolveAnchorForDisplay's single-remaining-match fallback — exactly what
// renderReview/CommentLocation use to show it healthy. classifyAnchor must
// use the same resolver, or a comment the review body displays as resolved
// (e.g. "節B (L24)") gets contradicted by the banner calling it 位置不明,
// even though the edit never touched its section.
func TestDriftBanner_ResolvableViaDisplayFallback_NotFlagged(t *testing.T) {
	root := withRoots(t)
	t.Setenv("REVIEWER_CONFIG_DIR", t.TempDir())
	body := "# タイトル\n\n節Aの本文。ここにコメントを付ける。\n\n## 節B\n\n節Bの本文。\n"
	rel := setupDoc(t, root, body)

	untouched, err := reviewstore.AddComment("works", rel, reviewstore.Comment{
		Scope: "inline", Status: reviewstore.StatusOpen,
		// No "#" prefix on HeadingPath — mirrors how POST /api/comments
		// actually stores it (rendered heading text), which plain
		// ResolveAnchor's headingStacks (entries carry their "#" markers)
		// can never match.
		Anchor: &reviewstore.Anchor{HeadingPath: []string{"節B"}, Snippet: "節Bの本文", Occurrence: 0},
	})
	if err != nil {
		t.Fatalf("AddComment: %v", err)
	}

	// Only 節A changes; 節B (and this comment's anchor) is untouched.
	newBody := "# タイトル\n\n節Aの本文。ここにコメントを付ける。書き換えた。\n\n追加の段落。\n\n## 節B\n\n節Bの本文。\n"
	if wErr := os.WriteFile(filepath.Join(root, rel), []byte(newBody), 0o644); wErr != nil {
		t.Fatal(wErr)
	}

	cm, ok, lErr := lookupComment(rel, untouched.ID)
	if lErr != nil || !ok {
		t.Fatalf("lookupComment: ok=%v err=%v", ok, lErr)
	}

	// Precondition: this anchor is exactly the shape that only resolves
	// through the display fallback, not plain ResolveAnchor — otherwise this
	// test would not exercise the regression at all.
	if _, ok := reviewstore.ResolveAnchor(newBody, *cm.Anchor); ok {
		t.Fatal("precondition failed: anchor resolves under plain ResolveAnchor; this test needs a fallback-only anchor")
	}
	if _, _, ok := reviewstore.ResolveAnchorForDisplay(newBody, *cm.Anchor); !ok {
		t.Fatal("precondition failed: anchor does not resolve even via ResolveAnchorForDisplay")
	}

	banner, err := driftBanner("works", rel, []reviewstore.Comment{cm}, newBody)
	if err != nil {
		t.Fatalf("driftBanner: %v", err)
	}
	if strings.Contains(banner, untouched.ID) {
		t.Errorf("comment %s resolves fine via the same resolver the review body uses; must not be reported as impacted: %q", untouched.ID, banner)
	}
}

// lookupComment reads back one comment by id, purely a test convenience so
// TestDriftBanner_ImpactedComments can build the comments slice driftBanner
// expects (the caller normally gets this from readForReview).
func lookupComment(rel, id string) (reviewstore.Comment, bool, error) {
	review, err := reviewstore.ReadReview("works", rel)
	if err != nil {
		return reviewstore.Comment{}, false, err
	}
	for _, c := range review.Comments {
		if c.ID == id {
			return c, true, nil
		}
	}
	return reviewstore.Comment{}, false, nil
}
