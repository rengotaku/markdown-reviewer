package main

import (
	"fmt"
	"strings"
	"time"

	"github.com/pmezard/go-difflib/difflib"

	"markdown-reviewer/internal/reviewstore"
)

// driftBanner builds the "本文が変わっています" warning `mr comments`/`mr
// review` print above their normal output (#322). It returns "" when there
// is nothing to say — no prior last_read to compare against, or the body is
// byte-for-byte (hint-stripped) unchanged — and callers must print nothing
// in that case: a banner that fires on every read gets ignored, which is the
// exact failure mode this feature exists to prevent.
//
// comments is the *unfiltered* comment list (before --since/--unanswered),
// since the banner describes the whole document's drift, not a narrowed
// view of it. currentContent is the raw canonical body (hint included, as
// read from disk) — StripAIHint/ShortSha are applied here so callers do not
// have to normalize it themselves.
func driftBanner(root, rel string, comments []reviewstore.Comment, currentContent string) (string, error) {
	prior, ok, err := reviewstore.ReadLastRead(root, rel)
	if err != nil || !ok {
		return "", err
	}
	stripped := reviewstore.StripAIHint(currentContent)
	currentSha := reviewstore.ShortSha(stripped)
	if prior.Sha == currentSha {
		return "", nil
	}

	var b strings.Builder
	fmt.Fprintf(&b, "⚠ 前回 mr で読んだ時（%s）から本文が変わっています\n", formatLastReadTs(prior.Ts))

	baseRev, found, err := reviewstore.GetRevision(root, rel, prior.RevID)
	if err != nil {
		return "", err
	}
	if !found {
		// The revision last_read pointed at fell off history.jsonl's
		// MaxRevisions window (or last_read predates any revision at all).
		// There is nothing to diff stats against, but orphan detection
		// (impactedComments with an empty baseline) still works from
		// currentContent alone.
		b.WriteString("  基準版が履歴から失われています\n")
		writeImpacted(&b, impactedComments(comments, currentContent, ""))
		fmt.Fprintf(&b, "  差分: mr diff %s --since-last-read\n", rel)
		return b.String(), nil
	}

	revs, err := revisionsAfter(root, rel, prior.RevID)
	if err != nil {
		return "", err
	}
	added, removed := lineDiffStats(baseRev.Content, stripped)
	fmt.Fprintf(&b, "  %d リビジョン（%s） +%d -%d 行\n",
		len(revs), strings.Join(chronologicalAuthors(revs), ", "), added, removed)
	writeImpacted(&b, impactedComments(comments, currentContent, baseRev.Content))
	fmt.Fprintf(&b, "  差分: mr diff %s --since-last-read\n", rel)
	return b.String(), nil
}

// formatLastReadTs renders a last_read.Ts (RFC3339) as "2026-09-14 10:32" for
// the banner; a value that fails to parse (e.g. hand-edited sidecar) is
// echoed as-is rather than hidden.
func formatLastReadTs(ts string) string {
	t, err := time.Parse(time.RFC3339, ts)
	if err != nil {
		return ts
	}
	return t.Format("2006-01-02 15:04")
}

// revisionsAfter returns the revisions strictly newer than baselineID,
// newest-first (the same order ListRevisions uses). It works by walking
// ListRevisions' newest-first projection and stopping at baselineID, so it
// never needs to parse revision ids as numbers.
func revisionsAfter(root, rel, baselineID string) ([]reviewstore.RevisionMeta, error) {
	metas, err := reviewstore.ListRevisions(root, rel)
	if err != nil {
		return nil, err
	}
	out := make([]reviewstore.RevisionMeta, 0, len(metas))
	for _, m := range metas {
		if m.ID == baselineID {
			break
		}
		out = append(out, m)
	}
	return out, nil
}

// chronologicalAuthors returns revs' authors oldest-first (revs itself is
// newest-first, ListRevisions' convention) so the banner reads like a
// timeline: "human, external" means a human edit landed, then an external
// (unattributed) one on top of it.
func chronologicalAuthors(revs []reviewstore.RevisionMeta) []string {
	out := make([]string, len(revs))
	for i, r := range revs {
		out[len(revs)-1-i] = r.Author
	}
	return out
}

// lineDiffStats counts added/removed lines between two full-document bodies
// via the same line-level sequence matcher `mr diff` uses for its unified
// diff, so the banner's "+N -M 行" and the diff output it points at always
// agree.
func lineDiffStats(oldContent, newContent string) (added, removed int) {
	oldLines := difflib.SplitLines(oldContent)
	newLines := difflib.SplitLines(newContent)
	m := difflib.NewMatcher(oldLines, newLines)
	for _, op := range m.GetOpCodes() {
		switch op.Tag {
		case 'r':
			removed += op.I2 - op.I1
			added += op.J2 - op.J1
		case 'd':
			removed += op.I2 - op.I1
		case 'i':
			added += op.J2 - op.J1
		}
	}
	return added, removed
}

// impactedComment is one open comment the banner calls out by id and reason.
type impactedComment struct {
	id     string
	reason string
}

// impactedComments classifies each open comment whose position is affected
// by drift since the baseline into one of two reasons — and only these two
// (issue #322's "決めておきたい粒度"): a bare position shift (the anchor's
// occurrence/heading path moved but its text is unchanged) is deliberately
// never reported, or the banner would fire on every unrelated edit and stop
// being read.
//
//   - "位置不明": the anchor no longer resolves against currentContent at
//     all (orphaned, or its snippet/heading/occurrence no longer match
//     anything there).
//   - "アンカー行が変更": the anchor still resolves, but the exact
//     (markup-stripped, trimmed) text of the line it resolves to did not
//     exist anywhere in baselineContent — so that line's content itself was
//     rewritten, not merely relocated (a pure move keeps the old line's text
//     intact somewhere in the baseline, which this check finds and treats as
//     "not impacted").
//
// currentContent must be the exact same content (hint block included) that
// the caller feeds renderReview/CommentLocation right below the banner — a
// comment the review body shows as resolved must never be flagged as
// impacted here (round-trip regression: the resolver used to be plain
// ResolveAnchor while the renderer used ResolveAnchorForDisplay's
// single-remaining-match fallback, so a comment the review body resolved
// fine could still show up in "影響" as 位置不明). Both now go through
// ResolveAnchorForDisplay, and currentLines must be split from that same
// content so an index into currentLines lines up with the resolver's
// line numbers.
//
// baselineContent == "" (the baseline revision fell out of history) disables
// the second check entirely — there is nothing to compare text against —
// but the first still works from currentContent alone.
func impactedComments(comments []reviewstore.Comment, currentContent, baselineContent string) []impactedComment {
	var baselineLines []string
	if baselineContent != "" {
		for _, l := range strings.Split(baselineContent, "\n") {
			baselineLines = append(baselineLines, strings.TrimSpace(reviewstore.StripInlineMarkup(l)))
		}
	}
	currentLines := strings.Split(currentContent, "\n")

	var out []impactedComment
	for _, cm := range comments {
		if cm.Status != reviewstore.StatusOpen {
			continue
		}
		reason := classifyComment(cm, currentContent, currentLines, baselineLines)
		if reason != "" {
			out = append(out, impactedComment{id: cm.ID, reason: reason})
		}
	}
	return out
}

// classifyComment applies classifyAnchor to every anchor a comment carries
// (AnchorsOf: Anchor for scoped comments, Anchors for cross_section — the
// same flattening CommentLocation/renderReview use) and reports the most
// severe result: "位置不明" beats "アンカー行が変更" beats "" (not
// impacted), since an unresolved anchor is worse news than a moved one.
func classifyComment(cm reviewstore.Comment, currentContent string, currentLines, baselineLines []string) string {
	anchors := reviewstore.AnchorsOf(cm)
	if len(anchors) == 0 {
		return "" // global scope: nothing to lose a position for
	}
	best := ""
	for _, a := range anchors {
		switch classifyAnchor(a, currentContent, currentLines, baselineLines) {
		case "位置不明":
			return "位置不明" // most severe; no anchor can make it worse
		case "アンカー行が変更":
			best = "アンカー行が変更"
		}
	}
	return best
}

// classifyAnchor is impactedComments' per-anchor decision. It resolves via
// ResolveAnchorForDisplay — the same resolver CommentLocation uses for the
// review body directly below the banner — so a comment the review shows
// healthy is never reported as 位置不明 here (see impactedComments' doc
// comment). baselineLines nil means there is no baseline to compare text
// against (see impactedComments).
func classifyAnchor(a reviewstore.Anchor, currentContent string, currentLines, baselineLines []string) string {
	_, lr, ok := reviewstore.ResolveAnchorForDisplay(currentContent, a)
	if !ok {
		return "位置不明"
	}
	if baselineLines == nil {
		return ""
	}
	idx := lr[0] - 1
	if idx < 0 || idx >= len(currentLines) {
		return ""
	}
	currentLine := strings.TrimSpace(reviewstore.StripInlineMarkup(currentLines[idx]))
	if currentLine == "" {
		return "" // blank lines match trivially everywhere; never flag them
	}
	for _, bl := range baselineLines {
		if bl == currentLine {
			return "" // this exact text already existed somewhere before — a move, not a rewrite
		}
	}
	return "アンカー行が変更"
}

// writeImpacted appends the banner's "影響: ..." line, or nothing when no
// comment was impacted.
func writeImpacted(b *strings.Builder, impacted []impactedComment) {
	if len(impacted) == 0 {
		return
	}
	parts := make([]string, len(impacted))
	for i, ic := range impacted {
		parts[i] = fmt.Sprintf("%s %s", ic.id, ic.reason)
	}
	fmt.Fprintf(b, "  影響: %s\n", strings.Join(parts, " / "))
}

// recordLastRead stamps last_read.json after a tracked read (`mr
// comments`/`mr review`) has finished loading content — called once the read
// (and its banner) is complete, never before, so the banner always compares
// against the *previous* read's baseline.
func recordLastRead(root, rel, content string) error {
	stripped := reviewstore.StripAIHint(content)
	sha := reviewstore.ShortSha(stripped)
	revID, _, err := reviewstore.NewestRevisionID(root, rel)
	if err != nil {
		return err
	}
	return reviewstore.RecordLastRead(root, rel, sha, revID)
}
