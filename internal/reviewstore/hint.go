package reviewstore

import (
	"regexp"
	"strings"
)

// hintBlockRe matches a markdown-reviewer AI hint comment at the very top of
// the file, plus any *fully blank* lines directly after it. The leading `\A`
// anchors to the file start — only the first block counts, never a stray
// comment mid-file.
//
// The regex lives here (not in the handler that injects the hint) because
// "revision snapshots are hint-free" is a store invariant: every writer of
// history.jsonl and every drift comparison must strip the hint identically,
// so the store owns the single stripper they all share.
//
// The trailing `[ \t]*\n(?:[ \t]*\n)*` is deliberately line-scoped rather
// than a blanket `\s*`: a blanket match also swallows a following content
// line's leading indentation (e.g. a fenced/indented code block starting
// right after the hint), silently de-indenting every stored revision and,
// on restore, turning that code block into a plain paragraph (issue #282
// codex review round 2 — round 1 already fixed HintBlock's copy of this bug
// but left this one, the snapshot side, in place). `[ \t]*\n` only consumes
// a line that is blank *up to its newline*; a line that goes on to carry
// real content (however indented) never matches, so its indentation always
// survives into the stripped body.
var hintBlockRe = regexp.MustCompile(`(?s)\A<!--\s*markdown-reviewer\b.*?-->[ \t]*\r?\n(?:[ \t]*\r?\n)*`)

// StripAIHint removes the leading markdown-reviewer hint block (if any) so
// revision snapshots and the diffs computed from them are free of the
// per-save hint churn — the hint's embedded URLs change every save and would
// otherwise dominate the diff.
func StripAIHint(content string) string {
	body := hintBlockRe.ReplaceAllString(content, "")
	return strings.TrimLeft(body, "\n")
}

// HintBlock returns the leading markdown-reviewer hint block (including the
// blank line(s) buildAIHint always inserts after it), or "" if content
// carries none. It is StripAIHint's mirror image: Restore (#282) needs to
// re-prepend whatever hint block the file currently has onto a hint-stripped
// revision body, since revisions themselves never carry one.
//
// It shares hintBlockRe with StripAIHint (both need the same "stop at the
// first fully blank line" boundary — see that regex's doc comment) so a
// content line's own indentation is never mistaken for the hint's trailing
// spacing.
func HintBlock(content string) string {
	return hintBlockRe.FindString(content)
}
