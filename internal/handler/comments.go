package handler

import (
	"errors"
	"log/slog"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"

	"markdown-reviewer/internal/reviewstore"
)

// CommentContext is the resolved on-disk location of a comment, derived by
// searching the (clean) canonical content for the anchor snippet. It is null
// in the JSON when the comment is global or orphaned.
type CommentContext struct {
	HeadingPath []string `json:"heading_path"`
	LineRange   [2]int   `json:"line_range"`
}

// CommentJSON is the AI/UI-facing shape of one comment. The raw Anchor is
// surfaced as-is; Context is the resolved location (nil when global/orphan);
// Orphan flags an anchored comment whose snippet no longer matches.
type CommentJSON struct {
	ID      string              `json:"id"`
	Scope   string              `json:"scope"`
	GroupID string              `json:"group_id,omitempty"`
	Author  string              `json:"author,omitempty"`
	Date    string              `json:"date,omitempty"`
	Body    string              `json:"body"`
	Status  string              `json:"status"`
	Replies []reviewstore.Reply  `json:"replies,omitempty"`
	Anchor  *reviewstore.Anchor  `json:"anchor,omitempty"`
	Anchors []reviewstore.Anchor `json:"anchors,omitempty"`
	Context *CommentContext      `json:"context"`
	Orphan  bool                 `json:"orphan"`
}

// CommentsSummary is the count breakdown returned alongside the list.
type CommentsSummary struct {
	ByScope  map[string]int `json:"by_scope"`
	ByStatus map[string]int `json:"by_status"`
	Total    int            `json:"total"`
}

// CommentsResponse is the body for GET /api/comments/*path. Comments now come
// from the sidecar review.json (#50), not from in-file markers — the canonical
// file is clean.
type CommentsResponse struct {
	File     string          `json:"file"`
	Root     string          `json:"root"`
	Summary  CommentsSummary `json:"summary"`
	Comments []CommentJSON   `json:"comments"`
}

// buildCommentJSON resolves a stored comment's anchor against content into the
// API shape.
func buildCommentJSON(content string, c reviewstore.Comment) CommentJSON {
	out := CommentJSON{
		ID: c.ID, Scope: c.Scope, GroupID: c.GroupID,
		Author: c.Author, Date: c.Date, Body: c.Body,
		Status: c.Status, Replies: c.Replies,
		Anchor: c.Anchor, Anchors: c.Anchors,
	}
	if c.Anchor == nil {
		// Cross-section comments carry Anchors instead of a single Anchor and
		// are resolved client-side; global comments have neither. Either way
		// there is no single line context to attach here.
		return out
	}
	if lr, ok := reviewstore.ResolveAnchor(content, *c.Anchor); ok {
		out.Context = &CommentContext{HeadingPath: c.Anchor.HeadingPath, LineRange: lr}
	} else {
		out.Orphan = true
	}
	return out
}

// ListComments returns the structured comments stored for the file.
func (h *Handler) ListComments(c *gin.Context) {
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

	list := make([]CommentJSON, 0, len(review.Comments))
	sum := CommentsSummary{ByScope: map[string]int{}, ByStatus: map[string]int{}, Total: len(review.Comments)}
	for _, cm := range review.Comments {
		list = append(list, buildCommentJSON(content, cm))
		sum.ByScope[cm.Scope]++
		sum.ByStatus[cm.Status]++
	}
	c.JSON(http.StatusOK, CommentsResponse{File: rel, Root: name, Summary: sum, Comments: list})
}

// CreateCommentRequest is the body for POST /api/comments/*path.
type CreateCommentRequest struct {
	Scope   string               `json:"scope"`
	GroupID string               `json:"group_id"`
	Author  string               `json:"author"`
	Date    string               `json:"date"`
	Body    string               `json:"body"`
	Anchor  *reviewstore.Anchor  `json:"anchor"`
	Anchors []reviewstore.Anchor `json:"anchors"`
}

// CreateComment appends a comment to the file's review.json. Requires the file
// to be ingested (review state); a draft yields 409.
func (h *Handler) CreateComment(c *gin.Context) {
	full, rel, name, ok := h.resolveRequest(c)
	if !ok {
		return
	}
	if _, statOK := h.statCanonical(c, full); !statOK {
		return
	}
	var req CreateCommentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	if req.Scope == "" || req.Body == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "scope and body are required"})
		return
	}
	created, err := reviewstore.AddComment(name, rel, reviewstore.Comment{
		Scope: req.Scope, GroupID: req.GroupID, Author: req.Author,
		Date: req.Date, Body: req.Body, Anchor: req.Anchor, Anchors: req.Anchors,
	})
	if err != nil {
		h.writeCommentErr(c, err)
		return
	}
	content, _ := os.ReadFile(full)
	c.JSON(http.StatusCreated, buildCommentJSON(string(content), created))
}

// UpdateRequest is the body for PATCH /api/comments/*path?id=... Either field
// may be set: status toggles open/resolved, body edits the comment text.
type UpdateRequest struct {
	Status string `json:"status"`
	Body   string `json:"body"`
}

// UpdateComment changes a comment's status (open/resolved) and/or body.
func (h *Handler) UpdateComment(c *gin.Context) {
	full, rel, name, ok := h.resolveRequest(c)
	if !ok {
		return
	}
	id := c.Query("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id query param required"})
		return
	}
	var req UpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	if req.Status == "" && req.Body == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "status or body is required"})
		return
	}
	if req.Status != "" &&
		req.Status != reviewstore.StatusOpen &&
		req.Status != reviewstore.StatusResolved {
		c.JSON(http.StatusBadRequest, gin.H{"error": "status must be open or resolved"})
		return
	}

	var updated reviewstore.Comment
	var err error
	if req.Body != "" {
		updated, err = reviewstore.UpdateCommentBody(name, rel, id, req.Body)
	}
	if err == nil && req.Status != "" {
		updated, err = reviewstore.UpdateCommentStatus(name, rel, id, req.Status)
	}
	if err != nil {
		h.writeCommentErr(c, err)
		return
	}
	content, _ := os.ReadFile(full)
	c.JSON(http.StatusOK, buildCommentJSON(string(content), updated))
}

// DeleteComment removes a comment by id.
func (h *Handler) DeleteComment(c *gin.Context) {
	_, rel, name, ok := h.resolveRequest(c)
	if !ok {
		return
	}
	id := c.Query("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id query param required"})
		return
	}
	if err := reviewstore.DeleteComment(name, rel, id); err != nil {
		h.writeCommentErr(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// ReplyRequest is the body for POST /api/replies/*path?id=...
type ReplyRequest struct {
	Author string `json:"author"`
	Date   string `json:"date"`
	Body   string `json:"body"`
}

// AddReply appends a threaded reply to a comment.
func (h *Handler) AddReply(c *gin.Context) {
	full, rel, name, ok := h.resolveRequest(c)
	if !ok {
		return
	}
	id := c.Query("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id query param required"})
		return
	}
	var req ReplyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	if req.Body == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "body is required"})
		return
	}
	updated, err := reviewstore.AddReply(name, rel, id, reviewstore.Reply{
		Author: req.Author, Date: req.Date, Body: req.Body,
	})
	if err != nil {
		h.writeCommentErr(c, err)
		return
	}
	content, _ := os.ReadFile(full)
	c.JSON(http.StatusOK, buildCommentJSON(string(content), updated))
}

// readCanonical reads the canonical file, writing the proper error response on
// failure. ok=false means a response was already written.
func (h *Handler) readCanonical(c *gin.Context, full string) (string, bool) {
	data, err := os.ReadFile(full)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
			return "", false
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read file"})
		return "", false
	}
	return string(data), true
}

// statCanonical confirms the canonical file exists before a write op.
func (h *Handler) statCanonical(c *gin.Context, full string) (os.FileInfo, bool) {
	info, err := os.Stat(full)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
			return nil, false
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to stat file"})
		return nil, false
	}
	return info, true
}

// writeCommentErr maps reviewstore errors to HTTP responses.
func (h *Handler) writeCommentErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, reviewstore.ErrNotIngested):
		c.JSON(http.StatusConflict, gin.H{"error": "file is not under review; ingest it first"})
	case errors.Is(err, reviewstore.ErrCommentNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "comment not found"})
	case errors.Is(err, reviewstore.ErrCommentResolved):
		c.JSON(http.StatusConflict, gin.H{"error": "comment is resolved; reopen it first"})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "comment operation failed"})
	}
}
