package reviewstore

import (
	"fmt"
	"strings"
)

// AnchorsOf flattens a comment's anchor(s): a single inline/block Anchor
// and/or the Anchors slice used for cross_section and multi-line inline
// comments (#162). Shared by cmd/mr/format.go and internal/handler/review.go
// so the AI-facing Markdown ("mr review" and GET /api/review) render
// identically.
func AnchorsOf(cm Comment) []Anchor {
	var out []Anchor
	if cm.Anchor != nil {
		out = append(out, *cm.Anchor)
	}
	out = append(out, cm.Anchors...)
	return out
}

// CommentLocation resolves a comment's anchor(s) to "見出し(L行)" labels
// joined by ", ", or "全体" when global, or "⚠ orphan" per anchor whose text
// no longer matches.
func CommentLocation(content string, cm Comment) string {
	anchors := AnchorsOf(cm)
	if len(anchors) == 0 {
		return "全体"
	}
	parts := make([]string, 0, len(anchors))
	for _, a := range anchors {
		if resolved, lr, ok := ResolveAnchorForDisplay(content, a); ok {
			heading := ""
			if n := len(resolved.HeadingPath); n > 0 {
				heading = resolved.HeadingPath[n-1] + " "
			}
			parts = append(parts, fmt.Sprintf("%s(L%d)", heading, lr[0]))
		} else {
			parts = append(parts, "⚠ orphan（対象テキストが見つかりません）")
		}
	}
	return strings.Join(parts, ", ")
}

// Snippets returns the target snippets across a comment's anchor(s).
func Snippets(cm Comment) []string {
	var out []string
	for _, a := range AnchorsOf(cm) {
		out = append(out, a.Snippet)
	}
	return out
}
