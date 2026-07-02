package main

import (
	"fmt"
	"io"
	"strings"

	"markdown-reviewer/internal/reviewstore"
)

// renderReview writes the file's comments as AI-facing Markdown — the same
// shape as the server's GET /api/review — resolving each anchor to a line
// number (or flagging it orphaned) against the canonical content.
func renderReview(w io.Writer, rel, content string, comments []reviewstore.Comment, onlyOpen bool) {
	_, _ = fmt.Fprintf(w, "# レビュー: %s\n\n", rel)
	shown := 0
	for _, cm := range comments {
		if onlyOpen && cm.Status != reviewstore.StatusOpen {
			continue
		}
		shown++
		renderComment(w, content, cm)
	}
	if shown == 0 {
		if onlyOpen {
			_, _ = fmt.Fprintln(w, "open コメントはありません。")
		} else {
			_, _ = fmt.Fprintln(w, "コメントはありません。")
		}
	}
}

// renderComment writes one comment block: id, scope, resolved location(s),
// target snippet(s), status, body, and threaded replies.
func renderComment(w io.Writer, content string, cm reviewstore.Comment) {
	_, _ = fmt.Fprintf(w, "## %s [%s] %s\n\n", cm.ID, cm.Scope, commentLocation(content, cm))
	for _, sn := range snippets(cm) {
		if sn != "" {
			_, _ = fmt.Fprintf(w, "> 対象: %s\n\n", sn)
		}
	}
	_, _ = fmt.Fprintf(w, "- 状態: %s\n", cm.Status)
	_, _ = fmt.Fprintf(w, "- 指摘: %s\n", cm.Body)
	for _, rep := range cm.Replies {
		who := rep.Author
		if who == "" {
			who = "?"
		}
		_, _ = fmt.Fprintf(w, "  - 返信 (%s): %s\n", who, rep.Body)
	}
	_, _ = fmt.Fprintln(w)
}

// anchorsOf flattens a comment's anchor(s): a single inline/block Anchor and/or
// the cross_section Anchors slice.
func anchorsOf(cm reviewstore.Comment) []reviewstore.Anchor {
	var out []reviewstore.Anchor
	if cm.Anchor != nil {
		out = append(out, *cm.Anchor)
	}
	out = append(out, cm.Anchors...)
	return out
}

// commentLocation resolves a comment's anchor(s) to "見出し(L行)" labels, or
// "全体" when global, or "⚠ orphan" for an anchor whose text no longer matches.
func commentLocation(content string, cm reviewstore.Comment) string {
	anchors := anchorsOf(cm)
	if len(anchors) == 0 {
		return "全体"
	}
	parts := make([]string, 0, len(anchors))
	for _, a := range anchors {
		if lr, ok := reviewstore.ResolveAnchor(content, a); ok {
			heading := ""
			if n := len(a.HeadingPath); n > 0 {
				heading = a.HeadingPath[n-1] + " "
			}
			parts = append(parts, fmt.Sprintf("%s(L%d)", heading, lr[0]))
		} else {
			parts = append(parts, "⚠ orphan（対象テキストが見つかりません）")
		}
	}
	return strings.Join(parts, ", ")
}

// snippets returns the target snippets across a comment's anchor(s).
func snippets(cm reviewstore.Comment) []string {
	var out []string
	for _, a := range anchorsOf(cm) {
		out = append(out, a.Snippet)
	}
	return out
}
