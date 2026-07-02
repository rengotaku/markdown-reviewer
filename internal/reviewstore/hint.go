package reviewstore

import (
	"regexp"
	"strings"
)

// hintBlockRe matches a markdown-reviewer AI hint comment at the very top of
// the file, with any trailing blank lines. The leading `\A` anchors to the
// file start — only the first block counts, never a stray comment mid-file.
//
// The regex lives here (not in the handler that injects the hint) because
// "revision snapshots are hint-free" is a store invariant: every writer of
// history.jsonl and every drift comparison must strip the hint identically,
// so the store owns the single stripper they all share.
var hintBlockRe = regexp.MustCompile(`(?s)\A<!--\s*markdown-reviewer\b.*?-->\s*\n*`)

// StripAIHint removes the leading markdown-reviewer hint block (if any) so
// revision snapshots and the diffs computed from them are free of the
// per-save hint churn — the hint's embedded URLs change every save and would
// otherwise dominate the diff.
func StripAIHint(content string) string {
	body := hintBlockRe.ReplaceAllString(content, "")
	return strings.TrimLeft(body, "\n")
}
