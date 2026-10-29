package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"markdown-reviewer/internal/reviewstore"
)

const commentAddBody = "# Title\n\n## 概要\n\nこれは **重要** な `code` の説明。\n\nsame line\n\nsame line\n\n## 詳細 {color=\"purple_bg\"}\n\nattr body text\n"

// setupCommentAdd writes commentAddBody into a throwaway root and ingests it.
func setupCommentAdd(t *testing.T) (path string) {
	t.Helper()
	root := withRoots(t)
	t.Setenv("REVIEWER_CONFIG_DIR", t.TempDir())
	path = filepath.Join(root, "doc.md")
	if err := os.WriteFile(path, []byte(commentAddBody), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := reviewstore.Ingest("works", "doc.md"); err != nil {
		t.Fatal(err)
	}
	return path
}

func storedComments(t *testing.T) []reviewstore.Comment {
	t.Helper()
	r, err := reviewstore.ReadReview("works", "doc.md")
	if err != nil {
		t.Fatal(err)
	}
	return r.Comments
}

func TestCommentAdd_Success(t *testing.T) {
	p := setupCommentAdd(t)
	out, err := captureStdout(t, func() error {
		return cmdComment([]string{"add", p, "--snippet", "same line", "--heading", "## 概要", "指摘です"})
	})
	if err != nil {
		t.Fatalf("cmdComment: %v", err)
	}
	cs := storedComments(t)
	if len(cs) != 1 {
		t.Fatalf("comments = %d, want 1", len(cs))
	}
	c := cs[0]
	if !strings.Contains(out, c.ID) || !strings.Contains(out, "lines 7-7") {
		t.Errorf("stdout = %q, want id %s and lines 7-7", out, c.ID)
	}
	if c.Author != "ai" {
		t.Errorf("author = %q, want default ai", c.Author)
	}
	if c.Scope != "inline" || c.Status != reviewstore.StatusOpen || c.Body != "指摘です" || c.Date == "" {
		t.Errorf("comment = %+v", c)
	}
	a := c.Anchor
	if a == nil || a.Snippet != "same line" || a.Occurrence != 0 || a.LineFingerprint != "same line" ||
		len(a.HeadingPath) != 1 || a.HeadingPath[0] != "## 概要" {
		t.Errorf("anchor = %+v", a)
	}
}

func TestCommentAdd_AuthorFlag(t *testing.T) {
	p := setupCommentAdd(t)
	if _, err := captureStdout(t, func() error {
		return cmdComment([]string{"add", p, "--snippet", "same line", "--author", "bob", "x"})
	}); err != nil {
		t.Fatal(err)
	}
	if got := storedComments(t)[0].Author; got != "bob" {
		t.Errorf("author = %q, want bob", got)
	}
}

func TestCommentAdd_NormalizesMarkupInSnippetAndHeading(t *testing.T) {
	p := setupCommentAdd(t)
	if _, err := captureStdout(t, func() error {
		return cmdComment([]string{"add", p, "--snippet", "これは **重要** な `code` の説明", "--heading", "## **概要**", "x"})
	}); err != nil {
		t.Fatalf("cmdComment: %v", err)
	}
	a := storedComments(t)[0].Anchor
	if a.Snippet != "これは 重要 な code の説明" || a.HeadingPath[0] != "## 概要" {
		t.Errorf("anchor = %+v, want markup stripped", a)
	}
}

func TestCommentAdd_Occurrence(t *testing.T) {
	p := setupCommentAdd(t)
	out, err := captureStdout(t, func() error {
		return cmdComment([]string{"add", p, "--snippet", "same line", "--occurrence", "1", "x"})
	})
	if err != nil {
		t.Fatalf("occurrence 1: %v", err)
	}
	if !strings.Contains(out, "lines 9-9") {
		t.Errorf("stdout = %q, want lines 9-9", out)
	}
	if storedComments(t)[0].Anchor.Occurrence != 1 {
		t.Errorf("stored occurrence != 1")
	}
}

func TestCommentAdd_OccurrenceOutOfRangeReportsCountAndWritesNothing(t *testing.T) {
	p := setupCommentAdd(t)
	_, err := captureStdout(t, func() error {
		return cmdComment([]string{"add", p, "--snippet", "same line", "--occurrence", "2", "x"})
	})
	if err == nil || !strings.Contains(err.Error(), "2 time(s)") {
		t.Fatalf("error = %v, want the occurrence count", err)
	}
	if n := len(storedComments(t)); n != 0 {
		t.Errorf("comments = %d, want 0", n)
	}
}

func TestCommentAdd_NegativeOccurrence(t *testing.T) {
	p := setupCommentAdd(t)
	_, err := captureStdout(t, func() error {
		return cmdComment([]string{"add", p, "--snippet", "same line", "--occurrence", "-1", "x"})
	})
	if err == nil || !strings.Contains(err.Error(), "--occurrence") {
		t.Fatalf("error = %v, want an --occurrence error", err)
	}
	if n := len(storedComments(t)); n != 0 {
		t.Errorf("comments = %d, want 0", n)
	}
}

func TestCommentAdd_HeadingWithAttributeBlockIsRejected(t *testing.T) {
	p := setupCommentAdd(t)
	_, err := captureStdout(t, func() error {
		return cmdComment([]string{"add", p, "--snippet", "attr body text", "--heading", `## 詳細 {color="purple_bg"}`, "x"})
	})
	if err == nil || !strings.Contains(err.Error(), "attribute block") {
		t.Fatalf("error = %v, want an attribute block error", err)
	}
	if n := len(storedComments(t)); n != 0 {
		t.Errorf("comments = %d, want 0", n)
	}
}

func TestCommentAdd_BodyHeadingWithAttributeExplainsWhy(t *testing.T) {
	p := setupCommentAdd(t)
	_, err := captureStdout(t, func() error {
		return cmdComment([]string{"add", p, "--snippet", "attr body text", "--heading", "## 詳細", "x"})
	})
	if err == nil || !strings.Contains(err.Error(), "carries an attribute block") {
		t.Fatalf("error = %v, want the attribute-block explanation", err)
	}
	if n := len(storedComments(t)); n != 0 {
		t.Errorf("comments = %d, want 0", n)
	}
	// Without --heading the same snippet anchors fine.
	if _, err := captureStdout(t, func() error {
		return cmdComment([]string{"add", p, "--snippet", "attr body text", "x"})
	}); err != nil {
		t.Fatalf("anchoring without --heading: %v", err)
	}
}

func TestCommentAdd_HeadingWithoutHashPrefixIsRejected(t *testing.T) {
	p := setupCommentAdd(t)
	_, err := captureStdout(t, func() error {
		return cmdComment([]string{"add", p, "--snippet", "same line", "--heading", "概要", "x"})
	})
	if err == nil || !strings.Contains(err.Error(), "# prefix") {
		t.Fatalf("error = %v, want a # prefix error", err)
	}
}

func TestCommentAdd_UnresolvableWritesNothing(t *testing.T) {
	p := setupCommentAdd(t)
	_, err := captureStdout(t, func() error {
		return cmdComment([]string{"add", p, "--snippet", "no such text", "x"})
	})
	if err == nil || !strings.Contains(err.Error(), "nothing was written") {
		t.Fatalf("error = %v, want a nothing-written error", err)
	}
	if n := len(storedComments(t)); n != 0 {
		t.Errorf("comments = %d, want 0", n)
	}
}

func TestCommentAdd_WrongHeadingReportsBodyCount(t *testing.T) {
	p := setupCommentAdd(t)
	_, err := captureStdout(t, func() error {
		return cmdComment([]string{"add", p, "--snippet", "same line", "--heading", "## 別の見出し", "x"})
	})
	if err == nil || !strings.Contains(err.Error(), "occurs 2 time(s) in the body") {
		t.Fatalf("error = %v, want the body count", err)
	}
}

func TestCommentAdd_UsageErrors(t *testing.T) {
	p := setupCommentAdd(t)
	for name, args := range map[string][]string{
		"no subcommand":   {},
		"unknown":         {"rm"},
		"missing text":    {"add", p, "--snippet", "same line"},
		"missing snippet": {"add", p, "x"},
	} {
		if _, err := captureStdout(t, func() error { return cmdComment(args) }); err == nil {
			t.Errorf("%s: want an error", name)
		}
	}
}

func TestCommentAdd_DriftGuardAndForce(t *testing.T) {
	p := setupCommentAdd(t)
	if err := recordLastRead("works", "doc.md", commentAddBody); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(commentAddBody+"\nappended\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	args := []string{"add", p, "--snippet", "same line", "x"}
	if _, err := captureStdout(t, func() error { return cmdComment(args) }); err == nil ||
		!strings.Contains(err.Error(), "変更されています") {
		t.Fatalf("error = %v, want the drift guard", err)
	}
	if n := len(storedComments(t)); n != 0 {
		t.Errorf("comments = %d, want 0 while blocked", n)
	}
	if _, err := captureStdout(t, func() error { return cmdComment(append(args, "--force")) }); err != nil {
		t.Fatalf("--force: %v", err)
	}
	if n := len(storedComments(t)); n != 1 {
		t.Errorf("comments = %d, want 1 after --force", n)
	}
}

func TestParseArgsMulti_RepeatedHeading(t *testing.T) {
	pos, flags, multi := parseArgsMulti([]string{"p", "--heading", "# A", "--heading", "## B", "t"})
	if len(pos) != 2 || flags["heading"] != "## B" || len(multi["heading"]) != 2 || multi["heading"][0] != "# A" {
		t.Errorf("pos=%v flags=%v multi=%v", pos, flags, multi)
	}
}
