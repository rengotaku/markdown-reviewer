package main

import (
	"fmt"
	"io"

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
	_, _ = fmt.Fprintf(w, "## %s [%s] %s\n\n", cm.ID, cm.Scope, reviewstore.CommentLocation(content, cm))
	for _, sn := range reviewstore.Snippets(cm) {
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
