package reviewstore

import (
	"errors"
	"testing"
)

func TestHasOpenComments(t *testing.T) {
	withTempStore(t)
	const root, rel = "rooms", "oc.md"

	// Not ingested → false, no error.
	got, err := HasOpenComments(root, rel)
	if err != nil {
		t.Fatalf("HasOpenComments (not ingested): %v", err)
	}
	if got {
		t.Fatal("want false for not-ingested file")
	}

	// Ingested but no comments yet → false.
	if ingErr := Ingest(root, rel); ingErr != nil {
		t.Fatalf("Ingest: %v", ingErr)
	}
	got, err = HasOpenComments(root, rel)
	if err != nil {
		t.Fatalf("HasOpenComments (no comments): %v", err)
	}
	if got {
		t.Fatal("want false when no comments")
	}

	// Add one open comment → true.
	c1, err := AddComment(root, rel, Comment{Scope: "global", Body: "open one"})
	if err != nil {
		t.Fatalf("AddComment: %v", err)
	}
	got, err = HasOpenComments(root, rel)
	if err != nil {
		t.Fatalf("HasOpenComments (open): %v", err)
	}
	if !got {
		t.Fatal("want true when open comment exists")
	}

	// Resolve the only comment → false.
	if _, updErr := UpdateCommentStatus(root, rel, c1.ID, StatusResolved); updErr != nil {
		t.Fatalf("UpdateCommentStatus: %v", updErr)
	}
	got, err = HasOpenComments(root, rel)
	if err != nil {
		t.Fatalf("HasOpenComments (all resolved): %v", err)
	}
	if got {
		t.Fatal("want false when all comments are resolved")
	}
}

func TestAddCommentRequiresIngest(t *testing.T) {
	withTempStore(t)
	if _, err := AddComment("rooms", "draft.md", Comment{Body: "x"}); !errors.Is(err, ErrNotIngested) {
		t.Fatalf("want ErrNotIngested, got %v", err)
	}
}

func TestCommentCRUD(t *testing.T) {
	withTempStore(t)
	const root, rel = "rooms", "doc.md"
	if err := Ingest(root, rel); err != nil {
		t.Fatalf("Ingest: %v", err)
	}

	c1, err := AddComment(root, rel, Comment{
		Scope: "inline", Author: "reviewer", Body: "直して",
		Anchor: &Anchor{HeadingPath: []string{"## A"}, Snippet: "foo", Occurrence: 0},
	})
	if err != nil {
		t.Fatalf("AddComment: %v", err)
	}
	if c1.ID != "c-001" || c1.Status != StatusOpen {
		t.Fatalf("unexpected first comment: %+v", c1)
	}
	c2, _ := AddComment(root, rel, Comment{Scope: "global", Body: "全体"})
	if c2.ID != "c-002" {
		t.Fatalf("want c-002, got %s", c2.ID)
	}

	// Reply + resolve.
	if _, rerr := AddReply(root, rel, "c-001", Reply{Author: "ai", Body: "対応しました"}); rerr != nil {
		t.Fatalf("AddReply: %v", rerr)
	}
	updated, err := UpdateCommentStatus(root, rel, "c-001", StatusResolved)
	if err != nil {
		t.Fatalf("UpdateCommentStatus: %v", err)
	}
	if updated.Status != StatusResolved || len(updated.Replies) != 1 {
		t.Fatalf("status/reply not persisted: %+v", updated)
	}

	// Persisted across reads.
	r, err := ReadReview(root, rel)
	if err != nil {
		t.Fatalf("ReadReview: %v", err)
	}
	if len(r.Comments) != 2 {
		t.Fatalf("want 2 comments, got %d", len(r.Comments))
	}

	// Delete.
	if err := DeleteComment(root, rel, "c-002"); err != nil {
		t.Fatalf("DeleteComment: %v", err)
	}
	if _, err := UpdateCommentStatus(root, rel, "c-002", StatusResolved); !errors.Is(err, ErrCommentNotFound) {
		t.Fatalf("want ErrCommentNotFound after delete, got %v", err)
	}
}

func TestReplyEditAndDeleteByIndex(t *testing.T) {
	withTempStore(t)
	const root, rel = "rooms", "doc.md"
	if err := Ingest(root, rel); err != nil {
		t.Fatalf("Ingest: %v", err)
	}
	if _, err := AddComment(root, rel, Comment{Scope: "global", Body: "全体"}); err != nil {
		t.Fatalf("AddComment: %v", err)
	}
	for _, b := range []string{"r0", "r1", "r2"} {
		if _, err := AddReply(root, rel, "c-001", Reply{Author: "ai", Body: b}); err != nil {
			t.Fatalf("AddReply %s: %v", b, err)
		}
	}

	// Edit the middle reply.
	if _, err := UpdateReplyBody(root, rel, "c-001", 1, "r1-edited"); err != nil {
		t.Fatalf("UpdateReplyBody: %v", err)
	}
	// Delete the first reply; the remaining ones shift down.
	updated, err := DeleteReply(root, rel, "c-001", 0)
	if err != nil {
		t.Fatalf("DeleteReply: %v", err)
	}
	if len(updated.Replies) != 2 ||
		updated.Replies[0].Body != "r1-edited" ||
		updated.Replies[1].Body != "r2" {
		t.Fatalf("unexpected replies after edit+delete: %+v", updated.Replies)
	}

	// Out-of-range index → ErrReplyNotFound.
	if _, err := UpdateReplyBody(root, rel, "c-001", 5, "x"); !errors.Is(err, ErrReplyNotFound) {
		t.Fatalf("want ErrReplyNotFound (edit), got %v", err)
	}
	if _, err := DeleteReply(root, rel, "c-001", -1); !errors.Is(err, ErrReplyNotFound) {
		t.Fatalf("want ErrReplyNotFound (delete), got %v", err)
	}

	// Resolved comment is read-only for reply mutations.
	if _, err := UpdateCommentStatus(root, rel, "c-001", StatusResolved); err != nil {
		t.Fatalf("UpdateCommentStatus: %v", err)
	}
	if _, err := UpdateReplyBody(root, rel, "c-001", 0, "y"); !errors.Is(err, ErrCommentResolved) {
		t.Fatalf("want ErrCommentResolved (edit), got %v", err)
	}
	if _, err := DeleteReply(root, rel, "c-001", 0); !errors.Is(err, ErrCommentResolved) {
		t.Fatalf("want ErrCommentResolved (delete), got %v", err)
	}
}

func TestReadReviewEmptyWhenNotIngested(t *testing.T) {
	withTempStore(t)
	r, err := ReadReview("rooms", "missing.md")
	if err != nil {
		t.Fatalf("ReadReview: %v", err)
	}
	if len(r.Comments) != 0 {
		t.Fatalf("want empty, got %d", len(r.Comments))
	}
}

func TestResolveAnchor(t *testing.T) {
	content := "# Title\n\n## トークンの期限\n\n- アクセストークン: 24 時間\n- リフレッシュトークン: なし\n\n## エラー\n\n24 時間 という別の出現\n"

	// Snippet under the right heading, first occurrence.
	lr, ok := ResolveAnchor(content, Anchor{
		HeadingPath: []string{"## トークンの期限"}, Snippet: "24 時間", Occurrence: 0,
	})
	if !ok || lr[0] != 5 {
		t.Fatalf("want line 5, got %v ok=%v", lr, ok)
	}

	// Heading-scoped: same snippet under a different heading.
	lr2, ok2 := ResolveAnchor(content, Anchor{
		HeadingPath: []string{"## エラー"}, Snippet: "24 時間", Occurrence: 0,
	})
	if !ok2 || lr2[0] != 10 {
		t.Fatalf("want line 10, got %v ok=%v", lr2, ok2)
	}

	// Orphan: snippet that no longer exists.
	if _, ok3 := ResolveAnchor(content, Anchor{Snippet: "存在しない文字列"}); ok3 {
		t.Fatal("expected orphan for missing snippet")
	}
}

// TestResolveAnchor_InlineMarkupInHeading guards the regression where an
// ancestor heading containing inline markup (here a code span) orphaned a
// comment even though nothing was edited: the frontend stored the heading_path
// with the markup rendered away, while the backend re-parsed it raw.
func TestResolveAnchor_InlineMarkupInHeading(t *testing.T) {
	content := "# 進捗レポート\n\n## 👁️ 台帳サマリ（`_watchlist.md` 全アクティブ行）\n\n### 棄却した仮説・教訓\n\n本文\n"

	// heading_path as the frontend stores it: code span rendered to literal
	// text, underscores preserved (CommonMark code-span precedence).
	a := Anchor{
		HeadingPath: []string{
			"# 進捗レポート",
			"## 👁️ 台帳サマリ（_watchlist.md 全アクティブ行）",
			"### 棄却した仮説・教訓",
		},
		Snippet:    "棄却した仮説・教訓",
		Occurrence: 0,
	}
	lr, ok := ResolveAnchor(content, a)
	if !ok || lr[0] != 5 {
		t.Fatalf("want line 5, got %v ok=%v", lr, ok)
	}
}

// TestResolveAnchor_CodeBlockLine (#163 D1/D2) pins down the contract the
// frontend must match: ResolveAnchor scans Markdown *lines*, so a snippet for
// one fenced-code-block line resolves, but a snippet spanning two lines
// (carrying a literal "\n") can never match any single line and orphans.
// This is the backend-side half of the #163 fix: the frontend now splits
// code blocks into one anchor per line so it never authors a D2-shaped
// snippet.
func TestResolveAnchor_CodeBlockLine(t *testing.T) {
	content := "# Title\n\n```go\nconst a = 1\nconst b = 2\n```\n"

	// D1: a single line's snippet (no newline) resolves to that line.
	lr, ok := ResolveAnchor(content, Anchor{Snippet: "const b = 2", Occurrence: 0})
	if !ok || lr[0] != 5 || lr[1] != 5 {
		t.Fatalf("D1: want line 5, got %v ok=%v", lr, ok)
	}

	// D2: a snippet spanning two lines (as a single PM code-block textblock
	// would produce pre-#163) can never match a `strings.Split` line and
	// orphans. This is the regression #163 was filed against — pin it here
	// so the backend contract stays fixed even if ResolveAnchor changes.
	if _, ok := ResolveAnchor(content, Anchor{Snippet: "const a = 1\nconst b = 2", Occurrence: 0}); ok {
		t.Fatal("D2: expected orphan for a snippet spanning two lines")
	}
}

// TestResolveAnchor_TableRowOccurrence (#164 D3) pins down the accepted
// limitation for a Markdown table row with duplicate cell text: the backend
// only has one line to offer, so occurrence 0 resolves to that line and any
// higher occurrence on the same line orphans.
func TestResolveAnchor_TableRowOccurrence(t *testing.T) {
	content := "| x | x |\n| --- | --- |\n"

	lr, ok := ResolveAnchor(content, Anchor{Snippet: "x", Occurrence: 0})
	if !ok || lr[0] != 1 {
		t.Fatalf("D3: want line 1 for occurrence 0, got %v ok=%v", lr, ok)
	}

	if _, ok := ResolveAnchor(content, Anchor{Snippet: "x", Occurrence: 1}); ok {
		t.Fatal("D3: expected orphan for occurrence 1 — the row is only one line")
	}
}

// TestResolveAnchor_FencedHashIsNotAHeading (#205) guards the regression where
// a shell comment inside a fenced code block was parsed as an ATX heading,
// resetting the heading stack for every line after the fence. Every comment
// below the first such fence then orphaned even though nothing was edited —
// the frontend builds heading_path from ProseMirror `heading` nodes, so fenced
// text never contributes there.
func TestResolveAnchor_FencedHashIsNotAHeading(t *testing.T) {
	content := "# 手順書\n\n## Step 0\n\n```bash\n# (b) 共有リソースの確認\nterraform state list\n```\n\n### ③ 移行先にデータが揃っていること\n\n本文\n"

	a := Anchor{
		HeadingPath: []string{"# 手順書", "## Step 0", "### ③ 移行先にデータが揃っていること"},
		Snippet:     "③ 移行先にデータが揃っていること",
		Occurrence:  0,
	}
	lr, ok := ResolveAnchor(content, a)
	if !ok || lr[0] != 10 {
		t.Fatalf("want line 10, got %v ok=%v", lr, ok)
	}

	// The fenced line itself stays anchorable (#163 D1) — the fix only stops it
	// from being treated as a heading.
	lr2, ok2 := ResolveAnchor(content, Anchor{
		HeadingPath: []string{"## Step 0"}, Snippet: "# (b) 共有リソースの確認", Occurrence: 0,
	})
	if !ok2 || lr2[0] != 6 {
		t.Fatalf("fenced line: want line 6, got %v ok=%v", lr2, ok2)
	}
}

// TestHeadingStacks_Fences covers the fence-tracking edge cases directly: tilde
// fences, an info string on the opening fence, a longer closing fence, and a
// `#` line that is a real heading again once the fence closes.
func TestHeadingStacks_Fences(t *testing.T) {
	cases := []struct {
		// want maps a 1-indexed line to the heading stack expected there.
		want    map[int][]string
		name    string
		content string
	}{
		{
			name:    "backtick fence with info string",
			content: "# A\n\n```console\n# not a heading\n```\n\n## B\n",
			want:    map[int][]string{4: {"# A"}, 7: {"# A", "## B"}},
		},
		{
			name:    "tilde fence",
			content: "# A\n\n~~~\n# not a heading\n~~~\n\n## B\n",
			want:    map[int][]string{4: {"# A"}, 7: {"# A", "## B"}},
		},
		{
			name:    "closing fence may be longer than the opener",
			content: "# A\n\n```\n# not a heading\n`````\n\n## B\n",
			want:    map[int][]string{4: {"# A"}, 7: {"# A", "## B"}},
		},
		{
			name:    "a shorter run does not close the fence",
			content: "# A\n\n````\n```\n# not a heading\n````\n\n## B\n",
			want:    map[int][]string{5: {"# A"}, 8: {"# A", "## B"}},
		},
		{
			name:    "a tilde run does not close a backtick fence",
			content: "# A\n\n```\n~~~\n# not a heading\n```\n\n## B\n",
			want:    map[int][]string{5: {"# A"}, 8: {"# A", "## B"}},
		},
		{
			name:    "unterminated fence swallows the rest of the document",
			content: "# A\n\n```\n# not a heading\n\n## also not a heading\n",
			want:    map[int][]string{4: {"# A"}, 6: {"# A"}},
		},
		{
			// A fence nested under a bullet is indented past the left margin
			// but only up to 3 columns past the item's content column, so it
			// is still a fence.
			name:    "fence nested under a list item is a fence",
			content: "# A\n\n- 手順:\n\n    ```bash\n    # not a heading\n    ```\n\n## B\n",
			want:    map[int][]string{6: {"# A"}, 9: {"# A", "## B"}},
		},
		{
			// 4 columns at the document root is an indented code block, so the
			// ``` is literal text. Treating it as an opener would swallow the
			// rest of the document and orphan everything below it.
			name:    "4-column indent at the root is not a fence",
			content: "# A\n\n    ```\n    # literal, not a heading\n\n## B\n\n本文\n",
			want:    map[int][]string{4: {"# A"}, 8: {"# A", "## B"}},
		},
		{
			// Once the list ends, the allowance goes back to the root's 3.
			name:    "allowance resets after the list ends",
			content: "# A\n\n- 手順\n\n本文\n\n    ```\n\n## B\n",
			want:    map[int][]string{7: {"# A"}, 9: {"# A", "## B"}},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			stacks := headingStacks(tc.content)
			for line, want := range tc.want {
				got := stacks[line-1]
				if len(got) != len(want) {
					t.Fatalf("line %d: got %v, want %v", line, got, want)
				}
				for i := range want {
					if got[i] != want[i] {
						t.Fatalf("line %d: got %v, want %v", line, got, want)
					}
				}
			}
		})
	}
}

// TestResolveAnchorForDisplay covers the read-path fallback for a stale
// heading_path: anchors ReanchorReview rewrote before #205 carry a path taken
// from a mis-parsed stack (a fenced line recorded as the root heading), so
// strict resolution stops matching once the parser is fixed.
func TestResolveAnchorForDisplay(t *testing.T) {
	content := "# 本当の見出し\n\n## 節\n\n```\n# 見出しではない\n```\n\n対象の一文\n"

	stale := Anchor{
		HeadingPath: []string{"# 見出しではない", "## 節"},
		Snippet:     "対象の一文",
		Occurrence:  0,
	}
	if _, ok := ResolveAnchor(content, stale); ok {
		t.Fatal("strict resolution must still reject a stale heading_path, so reanchoring repairs it")
	}
	lr, ok := ResolveAnchorForDisplay(content, stale)
	if !ok || lr[0] != 9 {
		t.Fatalf("want line 9, got %v ok=%v", lr, ok)
	}

	// Ambiguous snippets stay orphaned — there is no single line to point at.
	ambiguous := "# A\n\n重複\n\n## B\n\n重複\n"
	if _, ok := ResolveAnchorForDisplay(ambiguous, Anchor{
		HeadingPath: []string{"## 消えた見出し"}, Snippet: "重複", Occurrence: 0,
	}); ok {
		t.Fatal("expected orphan for an ambiguous snippet")
	}

	// A snippet that is really gone stays orphaned.
	if _, ok := ResolveAnchorForDisplay(content, Anchor{Snippet: "存在しない文字列"}); ok {
		t.Fatal("expected orphan for a missing snippet")
	}
}

func TestStripInlineMarkup(t *testing.T) {
	cases := []struct{ in, want string }{
		{"## 👁️ 台帳サマリ（`_watchlist.md` 全アクティブ行）", "## 👁️ 台帳サマリ（_watchlist.md 全アクティブ行）"},
		{"plain text", "plain text"},
		{"a **bold** word", "a bold word"},
		{"a *em* word", "a em word"},
		{"an __under__ strong", "an under strong"},
		{"mix of `code` and **bold**", "mix of code and bold"},
		{"see [the docs](https://example.com)", "see the docs"},
		{"img ![alt](x.png) here", "img alt here"},
		{"~~struck~~ out", "struck out"},
		{"intraword foo_bar stays", "intraword foo_bar stays"},
		{"`a*b[c](d)` literal", "a*b[c](d) literal"},
		{"unmatched ` backtick", "unmatched ` backtick"},
	}
	for _, c := range cases {
		if got := stripInlineMarkup(c.in); got != c.want {
			t.Errorf("stripInlineMarkup(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
