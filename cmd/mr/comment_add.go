package main

import (
	"errors"
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"markdown-reviewer/internal/reviewstore"
)

const commentAddUsage = "usage: mr comment add <path> --snippet TEXT [--heading H]... [--occurrence N] [--author NAME] [--force] <text>"

// attrBlockRe matches a trailing Pandoc-style attribute block such as
// `{color="purple_bg"}` at the end of a heading.
var attrBlockRe = regexp.MustCompile(`\s*\{[^{}]*\}\s*$`)

// atxHeadingRe is the shape of an ATX heading line (same as the anchor
// package's heading parser).
var atxHeadingRe = regexp.MustCompile(`^(#{1,6})\s+(.+?)\s*$`)

func cmdComment(args []string) error {
	if len(args) == 0 || args[0] != "add" {
		return fmt.Errorf("usage: mr comment add ... (only \"add\" is supported)\n%s", commentAddUsage)
	}
	return cmdCommentAdd(args[1:])
}

// cmdCommentAdd creates one anchored (scope "inline") comment from a rendered
// snippet and optional heading path. It builds the anchor the way the web UI
// and POST /api/comments do — rendered-text snippet/headings, a stamped line
// fingerprint — and, like the handler, refuses to store an anchor that does
// not resolve against the current body (#347), so nothing is written for a
// comment that would show up as "位置不明".
func cmdCommentAdd(args []string) error {
	pos, flags, multi := parseArgsMulti(args)
	if len(pos) != 2 {
		return fmt.Errorf("%s", commentAddUsage)
	}
	snippet := flags["snippet"]
	if snippet == "" || snippet == "true" {
		return fmt.Errorf("--snippet is required\n%s", commentAddUsage)
	}
	text := pos[1]
	if strings.TrimSpace(text) == "" {
		return fmt.Errorf("comment text must not be empty")
	}
	occurrence := 0
	if v, ok := flags["occurrence"]; ok {
		n, err := strconv.Atoi(v)
		if err != nil || n < 0 {
			return fmt.Errorf("--occurrence must be a non-negative integer (0-based), got %q", v)
		}
		occurrence = n
	}
	headings, err := normalizeHeadings(multi["heading"])
	if err != nil {
		return err
	}

	root, rel, abs, err := resolveRegistered(pos[0])
	if err != nil {
		return err
	}
	if gerr := checkWriteGuard(root, rel, abs, flags["force"] != ""); gerr != nil {
		return gerr
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		return err
	}
	content := string(data)

	anchor := reviewstore.Anchor{
		Snippet:     reviewstore.StripInlineMarkup(snippet),
		HeadingPath: headings,
		Occurrence:  occurrence,
	}
	lr, ok := reviewstore.ResolveAnchor(content, anchor)
	if !ok {
		return unresolvedAnchorError(content, anchor)
	}
	reviewstore.StampFingerprint(content, &anchor)

	author := flags["author"]
	if author == "" {
		author = "ai"
	}
	created, err := reviewstore.AddComment(root, rel, reviewstore.Comment{
		Scope:  "inline",
		Author: author,
		Date:   time.Now().Format("2006-01-02"),
		Body:   text,
		Anchor: &anchor,
	})
	if err != nil {
		if errors.Is(err, reviewstore.ErrNotIngested) {
			return fmt.Errorf("%s is not under review yet; open it once with `mr open %s` (or ingest it in the web UI) first", rel, pos[0])
		}
		return err
	}
	fmt.Printf("added %s (lines %d-%d)\n", created.ID, lr[0], lr[1])
	return nil
}

// normalizeHeadings strips inline markup from each --heading and rejects the
// forms that can never match a rendered heading. The anchor's heading_path
// keeps each heading's `#` prefix (the level is part of the match), so a
// heading given without it is refused with the form to use.
func normalizeHeadings(raw []string) ([]string, error) {
	out := make([]string, 0, len(raw))
	for _, h := range raw {
		if attrBlockRe.MatchString(h) {
			return nil, fmt.Errorf("--heading %q ends with an attribute block ({...}); pass the heading text without the attribute block", h)
		}
		n := strings.TrimSpace(reviewstore.StripInlineMarkup(h))
		if !atxHeadingRe.MatchString(n) {
			return nil, fmt.Errorf("--heading %q must be the rendered heading with its # prefix, e.g. \"## Title\"", h)
		}
		out = append(out, n)
	}
	return out, nil
}

// unresolvedAnchorError explains why nothing was written: how many times the
// snippet occurs under the given headings (so a too-large --occurrence is
// obvious), and — the case the strict heading match hides — a body heading
// that only differs by a trailing attribute block.
func unresolvedAnchorError(content string, a reviewstore.Anchor) error {
	count := countSnippet(content, a)
	var b strings.Builder
	switch {
	case count > 0:
		fmt.Fprintf(&b, "snippet %q occurs %d time(s) under the given headings, so --occurrence %d (0-based) does not exist", a.Snippet, count, a.Occurrence)
	default:
		loose := a
		loose.HeadingPath = nil
		if n := countSnippet(content, loose); n > 0 && len(a.HeadingPath) > 0 {
			fmt.Fprintf(&b, "snippet %q occurs %d time(s) in the body, but not under the headings %q", a.Snippet, n, a.HeadingPath)
		} else {
			fmt.Fprintf(&b, "snippet %q does not occur in the rendered body", a.Snippet)
		}
	}
	for _, h := range a.HeadingPath {
		if line, found := attrHeadingFor(content, h); found {
			fmt.Fprintf(&b, "\n  the body heading %q carries an attribute block; headings are matched as rendered, attribute text included, so %q cannot match it — anchor without --heading (use --snippet and --occurrence) instead", line, h)
		}
	}
	b.WriteString("\n  nothing was written (snippet and headings are matched as rendered text, markup removed; headings keep their # prefix)")
	return fmt.Errorf("%s", b.String())
}

// countSnippet counts how many lines the anchor's snippet matches under its
// heading path, by walking occurrence indexes until one stops resolving.
func countSnippet(content string, a reviewstore.Anchor) int {
	n := 0
	for ; n < 100000; n++ {
		probe := a
		probe.Occurrence = n
		if _, ok := reviewstore.ResolveAnchor(content, probe); !ok {
			break
		}
	}
	return n
}

// attrHeadingFor finds a body heading whose text equals want once its trailing
// attribute block is removed, returning the raw heading line.
func attrHeadingFor(content, want string) (string, bool) {
	for _, line := range strings.Split(content, "\n") {
		m := atxHeadingRe.FindStringSubmatch(strings.TrimSpace(line))
		if m == nil || !attrBlockRe.MatchString(m[2]) {
			continue
		}
		bare := m[1] + " " + attrBlockRe.ReplaceAllString(m[2], "")
		if reviewstore.StripInlineMarkup(bare) == want {
			return strings.TrimSpace(line), true
		}
	}
	return "", false
}
