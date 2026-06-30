package main

import (
	"path/filepath"
	"testing"
)

func TestParseArgs(t *testing.T) {
	pos, flags := parseArgs([]string{"file.md", "c-001", "本文", "--author", "ai", "--all"})
	if len(pos) != 3 || pos[0] != "file.md" || pos[1] != "c-001" || pos[2] != "本文" {
		t.Fatalf("positionals = %v", pos)
	}
	if flags["author"] != "ai" {
		t.Errorf("author = %q", flags["author"])
	}
	if flags["all"] != "true" {
		t.Errorf("bare flag --all = %q, want \"true\"", flags["all"])
	}
}

func TestParseArgs_FlagBeforePositional(t *testing.T) {
	pos, flags := parseArgs([]string{"--json", "file.md"})
	if flags["json"] != "true" {
		t.Errorf("--json = %q", flags["json"])
	}
	if len(pos) != 1 || pos[0] != "file.md" {
		t.Fatalf("positionals = %v", pos)
	}
}

func TestRelUnder(t *testing.T) {
	root := filepath.FromSlash("/Users/x/ot/reviews")
	cases := []struct {
		file string
		want string
		ok   bool
	}{
		{"/Users/x/ot/reviews/daily/2026-06-30/r.md", "daily/2026-06-30/r.md", true},
		{"/Users/x/ot/reviews", "", false},    // the root itself
		{"/Users/x/ot/works/a.md", "", false}, // sibling root
		{"/Users/x/other/a.md", "", false},    // outside
	}
	for _, c := range cases {
		got, ok := relUnder(root, filepath.FromSlash(c.file))
		if ok != c.ok || got != c.want {
			t.Errorf("relUnder(%q) = (%q,%v), want (%q,%v)", c.file, got, ok, c.want, c.ok)
		}
	}
}

func TestExpandHome(t *testing.T) {
	if got := expandHome("/abs/path"); got != "/abs/path" {
		t.Errorf("absolute path changed: %q", got)
	}
	got := expandHome("~/ot/reviews")
	if filepath.IsAbs(got) == false || filepath.Base(got) != "reviews" {
		t.Errorf("expandHome(~/ot/reviews) = %q", got)
	}
}
