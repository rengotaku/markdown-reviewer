package handler

import (
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"

	"markdown-reviewer/internal/reviewstore"
)

// reviewState maps a (root, relPath) pair to the draft/review lifecycle state.
// A file is in "review" once it has been ingested (its review.json exists),
// "draft" otherwise. This is the single signal the UI uses to show the
// "review 中" indicator and gate the revision-diff affordances.
func reviewState(root, rel string) string {
	if reviewstore.HasEntry(root, rel) {
		return "review"
	}
	return "draft"
}

// IngestResponse is the body returned by POST /api/ingest/*path.
type IngestResponse struct {
	Path  string `json:"path"`
	Root  string `json:"root"`
	State string `json:"state"`
}

// IngestFile transitions a draft file into the managed review lifecycle by
// creating its entry under ~/.config/reviewer. The canonical bytes in the
// room folder are left untouched. Idempotent — re-ingesting an already-managed
// file is a no-op that still returns 200 with state="review".
func (h *Handler) IngestFile(c *gin.Context) {
	full, rel, name, ok := h.resolveRequest(c)
	if !ok {
		return
	}
	// The canonical file must exist before it can be put under review; a
	// missing file almost always means a stale/typo'd path from the client.
	if _, err := os.Stat(full); err != nil {
		if os.IsNotExist(err) {
			c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to stat file"})
		return
	}
	if err := reviewstore.Ingest(name, rel); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to ingest"})
		return
	}
	c.JSON(http.StatusOK, IngestResponse{Path: rel, Root: name, State: "review"})
}

// RevisionListResponse is the body for GET /api/revisions/*path (no id).
type RevisionListResponse struct {
	Path      string                     `json:"path"`
	Root      string                     `json:"root"`
	Revisions []reviewstore.RevisionMeta `json:"revisions"`
}

// RevisionResponse is the body for GET /api/revisions/*path?id=... .
type RevisionResponse struct {
	ID      string `json:"id"`
	Ts      string `json:"ts"`
	Author  string `json:"author"`
	Content string `json:"content"`
}

// Revisions serves both the revision list and a single revision's content off
// one route, disambiguated by the `id` query param. A single route avoids
// gin's catch-all-then-static path conflict (`*path/{id}` is not expressible),
// while keeping the server "dumb": it returns version contents and lets the
// client compute the diff.
func (h *Handler) Revisions(c *gin.Context) {
	_, rel, name, ok := h.resolveRequest(c)
	if !ok {
		return
	}
	if id := c.Query("id"); id != "" {
		rev, found, err := reviewstore.GetRevision(name, rel, id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read revision"})
			return
		}
		if !found {
			c.JSON(http.StatusNotFound, gin.H{"error": "revision not found"})
			return
		}
		c.JSON(http.StatusOK, RevisionResponse{
			ID: rev.ID, Ts: rev.Ts, Author: rev.Author, Content: rev.Content,
		})
		return
	}

	metas, err := reviewstore.ListRevisions(name, rel)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list revisions"})
		return
	}
	if metas == nil {
		metas = []reviewstore.RevisionMeta{}
	}
	c.JSON(http.StatusOK, RevisionListResponse{Path: rel, Root: name, Revisions: metas})
}

// ReviewMarkdown renders the file's comments as AI-facing Markdown so an AI
// client can read the open review with one GET. Defaults to open comments;
// `?status=all` includes resolved ones. The canonical content is used to
// resolve each anchor to a line number (or flag it orphaned).
func (h *Handler) ReviewMarkdown(c *gin.Context) {
	full, rel, name, ok := h.resolveRequest(c)
	if !ok {
		return
	}
	content, ok := h.readCanonical(c, full)
	if !ok {
		return
	}
	// Re-anchor after an out-of-band edit (AI file tools bypass PUT) before
	// resolving anchors below. A failure must never block the read — the
	// worst case is the pre-sync behavior (orphans), so log and continue.
	if _, serr := reviewstore.SyncExternalEdit(name, rel, content); serr != nil {
		slog.Warn("external edit sync failed", "root", name, "path", rel, "err", serr)
	}
	review, err := reviewstore.ReadReview(name, rel)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read review"})
		return
	}
	onlyOpen := c.Query("status") != "all"

	var b strings.Builder
	fmt.Fprintf(&b, "# レビュー: %s\n\n", rel)
	shown := 0
	for _, cm := range review.Comments {
		if onlyOpen && cm.Status != reviewstore.StatusOpen {
			continue
		}
		shown++
		writeReviewComment(&b, content, cm)
	}
	if shown == 0 {
		b.WriteString("open コメントはありません。\n")
	}
	c.Data(http.StatusOK, "text/markdown; charset=utf-8", []byte(b.String()))
}

// writeReviewComment appends one comment's Markdown block to b.
func writeReviewComment(b *strings.Builder, content string, cm reviewstore.Comment) {
	loc := "全体"
	if cm.Anchor != nil {
		if lr, ok := reviewstore.ResolveAnchor(content, *cm.Anchor); ok {
			heading := ""
			if n := len(cm.Anchor.HeadingPath); n > 0 {
				heading = cm.Anchor.HeadingPath[n-1] + " "
			}
			loc = fmt.Sprintf("%s(L%d)", heading, lr[0])
		} else {
			loc = "⚠ orphan（対象テキストが見つかりません）"
		}
	}
	fmt.Fprintf(b, "## %s [%s] %s\n\n", cm.ID, cm.Scope, loc)
	if cm.Anchor != nil && cm.Anchor.Snippet != "" {
		fmt.Fprintf(b, "> 対象: %s\n\n", cm.Anchor.Snippet)
	}
	fmt.Fprintf(b, "- 状態: %s\n", cm.Status)
	fmt.Fprintf(b, "- 指摘: %s\n", cm.Body)
	for _, rep := range cm.Replies {
		who := rep.Author
		if who == "" {
			who = "?"
		}
		fmt.Fprintf(b, "  - 返信 (%s): %s\n", who, rep.Body)
	}
	b.WriteString("\n")
}
