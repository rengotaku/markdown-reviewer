package comments

import (
	"encoding/json"
	"testing"
)

func TestParse_EmptyContent(t *testing.T) {
	t.Parallel()
	got, sum := Parse("")
	if len(got) != 0 {
		t.Fatalf("want 0 comments, got %d", len(got))
	}
	if sum.Total != 0 {
		t.Fatalf("want total=0, got %d", sum.Total)
	}
}

func TestParse_InlineComment(t *testing.T) {
	t.Parallel()
	src := `# Intro

This is <!-- @comment id="c1" author="kishira" date="2026-05-20" body="fix this" -->the word<!-- /@comment --> in a paragraph.
`
	got, _ := Parse(src)
	if len(got) != 1 {
		t.Fatalf("want 1, got %d", len(got))
	}
	c := got[0]
	if c.Scope != "inline" {
		t.Errorf("scope: want inline, got %q", c.Scope)
	}
	if c.ID != "c1" || c.Author != "kishira" || c.Date != "2026-05-20" {
		t.Errorf("attrs: %+v", c)
	}
	if c.Body != "fix this" {
		t.Errorf("body: %q", c.Body)
	}
	if c.WrappedText != "the word" {
		t.Errorf("wrapped: %q", c.WrappedText)
	}
	if c.Context == nil {
		t.Fatal("context: nil")
	}
	if got, want := c.Context.LineRange, [2]int{3, 3}; got != want {
		t.Errorf("line_range: got %v, want %v", got, want)
	}
	if len(c.Context.HeadingPath) != 1 || c.Context.HeadingPath[0] != "# Intro" {
		t.Errorf("heading_path: %v", c.Context.HeadingPath)
	}
}

func TestParse_BlockComment(t *testing.T) {
	t.Parallel()
	src := `## Section

<!-- @comment id="b1" author="k" date="2026-05-20" body="rewrite" scope="block" -->A whole paragraph.<!-- /@comment -->
`
	got, _ := Parse(src)
	if len(got) != 1 {
		t.Fatalf("want 1, got %d", len(got))
	}
	if got[0].Scope != "block" {
		t.Errorf("scope: %q", got[0].Scope)
	}
	if got[0].WrappedText != "A whole paragraph." {
		t.Errorf("wrapped: %q", got[0].WrappedText)
	}
	if got[0].Context.HeadingPath[0] != "## Section" {
		t.Errorf("heading_path: %v", got[0].Context.HeadingPath)
	}
}

func TestParse_GlobalComment(t *testing.T) {
	t.Parallel()
	src := `<!-- @comment id="g1" author="k" date="2026-05-25" body="file-wide note" scope="global" -->

# Doc
`
	got, _ := Parse(src)
	if len(got) != 1 {
		t.Fatalf("want 1, got %d", len(got))
	}
	if got[0].Scope != "global" {
		t.Errorf("scope: %q", got[0].Scope)
	}
	if got[0].Body != "file-wide note" {
		t.Errorf("body: %q", got[0].Body)
	}
	if got[0].Context != nil {
		t.Errorf("global must have nil context, got %+v", got[0].Context)
	}
}

func TestParse_LegacyCrossSectionStandalone(t *testing.T) {
	t.Parallel()
	src := `## A

## B

<!-- @comment id="x1" author="k" date="2026-05-25" target="## A\n## B" body="split these" scope="cross-section" -->
`
	got, _ := Parse(src)
	if len(got) != 1 {
		t.Fatalf("want 1, got %d", len(got))
	}
	if got[0].Scope != "cross_section" {
		t.Errorf("scope: %q", got[0].Scope)
	}
	if got[0].WrappedText != "## A\n## B" {
		t.Errorf("legacy target should surface as wrapped_text, got %q", got[0].WrappedText)
	}
	if got[0].GroupID != "" {
		t.Errorf("legacy must not have group_id, got %q", got[0].GroupID)
	}
}

func TestParse_GroupedCrossSection(t *testing.T) {
	t.Parallel()
	src := `# Top

### <!-- @comment id="g-a" author="k" date="2026-06-02" body="split DB vs S3" group_id="g-001" scope="block" -->Section A<!-- /@comment -->

content A

### <!-- @comment id="g-b" author="k" date="2026-06-02" body="split DB vs S3" group_id="g-001" scope="block" -->Section B<!-- /@comment -->

content B
`
	got, _ := Parse(src)
	if len(got) != 1 {
		t.Fatalf("want 1 group entry, got %d (%+v)", len(got), got)
	}
	c := got[0]
	if c.Scope != "cross_section" {
		t.Errorf("scope: %q", c.Scope)
	}
	if c.GroupID != "g-001" {
		t.Errorf("group_id: %q", c.GroupID)
	}
	if c.Context != nil {
		t.Errorf("group entry must have nil context, got %+v", c.Context)
	}
	if len(c.Members) != 2 {
		t.Fatalf("members: want 2, got %d", len(c.Members))
	}
	if c.Members[0].WrappedText != "Section A" || c.Members[1].WrappedText != "Section B" {
		t.Errorf("members order/text: %+v", c.Members)
	}
	// Each member's heading_path should include the heading it wraps.
	if got, want := c.Members[0].Context.HeadingPath, []string{"# Top", "### Section A"}; !equalStrings(got, want) {
		t.Errorf("member 0 heading_path: got %v want %v", got, want)
	}
	if got, want := c.Members[1].Context.HeadingPath, []string{"# Top", "### Section B"}; !equalStrings(got, want) {
		t.Errorf("member 1 heading_path: got %v want %v", got, want)
	}
}

func TestParse_AttrEscape(t *testing.T) {
	t.Parallel()
	// body contains a quote, a newline, a literal `--`, and a backslash.
	src := `<!-- @comment id="e1" author="k" date="2026-05-20" body="line1\nthen \"quoted\" and \-\- dashes \\\\backslash" -->x<!-- /@comment -->`
	got, _ := Parse(src)
	if len(got) != 1 {
		t.Fatalf("want 1, got %d", len(got))
	}
	want := "line1\nthen \"quoted\" and -- dashes \\\\backslash"
	if got[0].Body != want {
		t.Errorf("body decode mismatch:\n got=%q\nwant=%q", got[0].Body, want)
	}
}

func TestParse_MultipleComments_OrderedByLine(t *testing.T) {
	t.Parallel()
	src := `# Doc

<!-- @comment id="g1" author="k" date="2026-05-25" body="note" scope="global" -->

## A

Para <!-- @comment id="i1" author="k" date="2026-05-25" body="x" -->word<!-- /@comment --> tail.

## B

<!-- @comment id="b1" author="k" date="2026-05-25" body="y" scope="block" -->Block here.<!-- /@comment -->
`
	got, sum := Parse(src)
	if len(got) != 3 {
		t.Fatalf("want 3, got %d", len(got))
	}
	wantIDs := []string{"g1", "i1", "b1"}
	for i, c := range got {
		if c.ID != wantIDs[i] {
			t.Errorf("order[%d]: got %q want %q", i, c.ID, wantIDs[i])
		}
	}
	if sum.Total != 3 {
		t.Errorf("total: %d", sum.Total)
	}
	if sum.ByScope["global"] != 1 || sum.ByScope["inline"] != 1 || sum.ByScope["block"] != 1 {
		t.Errorf("by_scope: %+v", sum.ByScope)
	}
}

func TestParse_SameIDAcrossBlocks_MergedIntoMembers(t *testing.T) {
	t.Parallel()
	// ProseMirror persists a multi-paragraph mark as N markers sharing id.
	src := `Para A <!-- @comment id="same" author="k" date="2026-05-20" body="x" -->first<!-- /@comment --> tail.

<!-- @comment id="same" author="k" date="2026-05-20" body="x" -->second<!-- /@comment --> Para B.
`
	got, _ := Parse(src)
	if len(got) != 1 {
		t.Fatalf("want 1 merged entry, got %d", len(got))
	}
	c := got[0]
	if c.ID != "same" {
		t.Errorf("id: %q", c.ID)
	}
	if c.Scope != "inline" {
		t.Errorf("scope: %q (same-id splits keep their original scope)", c.Scope)
	}
	if c.Context != nil {
		t.Errorf("merged entry must have nil context (use members), got %+v", c.Context)
	}
	if len(c.Members) != 2 {
		t.Fatalf("members: want 2, got %d", len(c.Members))
	}
	if c.Members[0].WrappedText != "first" || c.Members[1].WrappedText != "second" {
		t.Errorf("members: %+v", c.Members)
	}
}

func TestParse_HeadingStack_PopsOnNewSection(t *testing.T) {
	t.Parallel()
	src := `# Top

## Sub1

### Deep

<!-- @comment id="a" author="k" date="2026-05-20" body="x" scope="global" -->

## Sub2

Para <!-- @comment id="b" author="k" date="2026-05-20" body="y" -->word<!-- /@comment -->.
`
	got, _ := Parse(src)
	var b *Comment
	for i := range got {
		if got[i].ID == "b" {
			b = &got[i]
		}
	}
	if b == nil {
		t.Fatal("comment b not found")
	}
	want := []string{"# Top", "## Sub2"}
	if !equalStrings(b.Context.HeadingPath, want) {
		t.Errorf("heading_path on Sub2: got %v want %v", b.Context.HeadingPath, want)
	}
}

func TestParse_JSONShape(t *testing.T) {
	t.Parallel()
	src := `# Doc

Hello <!-- @comment id="i1" author="k" date="2026-05-20" body="x" -->word<!-- /@comment -->.
`
	got, _ := Parse(src)
	b, err := json.Marshal(got[0])
	if err != nil {
		t.Fatal(err)
	}
	// Verify Context is emitted as object, not null, for anchored entries.
	if !contains(b, `"context":{`) {
		t.Errorf("expected context object, got: %s", b)
	}
	// Verify members is omitted when empty.
	if contains(b, `"members"`) {
		t.Errorf("expected members omitted, got: %s", b)
	}
	// Verify group_id omitted when empty.
	if contains(b, `"group_id"`) {
		t.Errorf("expected group_id omitted, got: %s", b)
	}
}

func TestParse_GlobalContext_IsExplicitNull(t *testing.T) {
	t.Parallel()
	src := `<!-- @comment id="g" author="k" date="2026-05-20" body="x" scope="global" -->`
	got, _ := Parse(src)
	b, err := json.Marshal(got[0])
	if err != nil {
		t.Fatal(err)
	}
	if !contains(b, `"context":null`) {
		t.Errorf("expected context null, got: %s", b)
	}
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func contains(haystack []byte, needle string) bool {
	return indexBytes(haystack, []byte(needle)) >= 0
}

func indexBytes(h, n []byte) int {
outer:
	for i := 0; i+len(n) <= len(h); i++ {
		for j := 0; j < len(n); j++ {
			if h[i+j] != n[j] {
				continue outer
			}
		}
		return i
	}
	return -1
}
