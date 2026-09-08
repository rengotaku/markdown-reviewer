package handler

import (
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"

	"markdown-reviewer/internal/files"
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

// writeReviewComment appends one comment's Markdown block to b. Location and
// snippet resolution are shared with `mr review`/`mr comments`
// (cmd/mr/format.go) via reviewstore.CommentLocation/Snippets so both surfaces
// render identically, including comments carrying multiple anchors (#162).
func writeReviewComment(b *strings.Builder, content string, cm reviewstore.Comment) {
	fmt.Fprintf(b, "## %s [%s] %s\n\n", cm.ID, cm.Scope, reviewstore.CommentLocation(content, cm))
	for _, sn := range reviewstore.Snippets(cm) {
		if sn != "" {
			fmt.Fprintf(b, "> 対象: %s\n\n", sn)
		}
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

// CreateRevisionResponse is the body for POST /api/revisions/*path.
type CreateRevisionResponse struct {
	Revision *reviewstore.RevisionMeta `json:"revision,omitempty"`
	Path     string                    `json:"path"`
	Root     string                    `json:"root"`
	// Created is false when the current content already matches the newest
	// revision, i.e. nothing changed since the last handoff.
	Created bool `json:"created"`
}

// CreateRevision snapshots the file's *current* on-disk content as a new
// revision (#280).
//
// Revisions mark handoffs to the AI, not saves. Autosave writes the file every
// few seconds, so snapshotting per save would burn through MaxRevisions in
// minutes and evict the very baseline the diff gutter needs — the state the AI
// last read. The client calls this once, when the user copies the
// `mr comments <path>` command, so the newest revision is always "what the AI
// is about to read": the diff is empty right after the copy and then fills up
// with the human's subsequent edits.
//
// Reading from disk rather than from a request body keeps the snapshot honest:
// the client flushes its pending save first, so what we store is exactly what
// the AI will read through the CLI.
func (h *Handler) CreateRevision(c *gin.Context) {
	// `action=restore` shares this route (POST /api/revisions/*path) rather
	// than a separate one, per issue #282 — restore fully replaces the
	// "current content" a plain POST would have snapshotted, so it makes
	// sense as a variant of the same endpoint instead of a sibling.
	if c.Query("action") == "restore" {
		h.RestoreRevision(c)
		return
	}
	full, rel, name, ok := h.resolveRequest(c)
	if !ok {
		return
	}
	raw, err := os.ReadFile(full)
	if err != nil {
		if os.IsNotExist(err) {
			c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read file"})
		return
	}
	// Ingest first: a draft file has no history to append to, and copying the
	// review command is at least as strong a signal of intent as a save.
	if ierr := reviewstore.Ingest(name, rel); ierr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to ingest"})
		return
	}
	author := c.Query("author")
	if author == "" {
		author = "human"
	}
	// Strip the AI hint so the per-save hint churn never shows up as a diff.
	rev, created, err := reviewstore.AppendRevision(name, rel, author, reviewstore.StripAIHint(string(raw)))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to append revision"})
		return
	}
	res := CreateRevisionResponse{Path: rel, Root: name, Created: created}
	if created {
		res.Revision = &reviewstore.RevisionMeta{
			ID: rev.ID, Ts: rev.Ts, Author: rev.Author,
		}
	}
	c.JSON(http.StatusOK, res)
}

// RestoreRevision handles POST /api/revisions/*path?id=<rev>&action=restore
// (issue #282). It shares the route with CreateRevision (dispatched by
// Routes on the `action` query param) and, like WriteFile, takes the same
// per-path lock, does an atomic write, and records the write via
// RecordAppWrite so the next comment read does not mistake this write for an
// external edit.
//
// The response mirrors FileReadResponse (same shape PUT /api/files returns)
// so the client can apply it the same way it applies a save response —
// content, sha, and the (unchanged) review lifecycle state.
func (h *Handler) RestoreRevision(c *gin.Context) {
	full, rel, name, ok := h.resolveRequest(c)
	if !ok {
		return
	}
	id := c.Query("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id required"})
		return
	}

	// Same per-path lock as WriteFile: the current body is read then a new
	// body is written back, and a concurrent PUT/restore for the same file
	// must not interleave with this read-modify-write.
	unlock := h.lockPath(full)
	defer unlock()

	raw, err := os.ReadFile(full)
	if err != nil {
		if os.IsNotExist(err) {
			c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read file"})
		return
	}

	restored, found, err := reviewstore.Restore(name, rel, id, restoreAuthor(c), string(raw))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to restore revision"})
		return
	}
	if !found {
		c.JSON(http.StatusNotFound, gin.H{"error": "revision not found"})
		return
	}

	if werr := atomicWrite(full, []byte(restored)); werr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to write file"})
		return
	}
	if werr := reviewstore.RecordAppWrite(name, rel, restored); werr != nil {
		slog.Warn("recording app write failed", "root", name, "path", rel, "err", werr)
	}

	var modified, created string
	if info, ierr := os.Stat(full); ierr == nil {
		modified, created = fileTimes(info)
	}
	c.JSON(http.StatusOK, FileReadResponse{
		Path:     rel,
		Content:  restored,
		Modified: modified,
		Created:  created,
		Root:     name,
		State:    reviewState(name, rel),
		Sha:      files.Sha256Hex([]byte(restored)),
	})
}

// restoreAuthor labels the "before restore" revision Restore appends as a
// side effect. Defaults to "human" for the same reason CreateRevision does —
// the Web UI is the primary caller and does not send ?author, and unlike the
// CLI it typically restores right after the user's own save, so "human" is
// the accurate default here (contrast `mr restore`, which defaults to
// "external" because the CLI has no way to know who last wrote the file on
// disk).
func restoreAuthor(c *gin.Context) string {
	if a := c.Query("author"); a != "" {
		return a
	}
	return "human"
}
