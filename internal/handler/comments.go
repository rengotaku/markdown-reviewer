package handler

import (
	"errors"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"

	"markdown-reviewer/internal/comments"
)

// CommentsResponse is the response body for GET /api/comments/*path. The
// shape matches issue #38: a flat list of structured comments plus a count
// summary so AI consumers can decide how to budget their reading.
type CommentsResponse struct {
	File     string             `json:"file"`
	Root     string             `json:"root"`
	Summary  comments.Summary   `json:"summary"`
	Comments []comments.Comment `json:"comments"`
}

// ListComments parses every `@comment` marker in <selected-root>/<path> and
// returns the AI-facing structured form. Uses the same resolver / 404 / 400
// plumbing as ReadFile so root-selection and path-traversal errors are
// reported consistently.
func (h *Handler) ListComments(c *gin.Context) {
	full, rel, name, ok := h.resolveRequest(c)
	if !ok {
		return
	}
	data, err := os.ReadFile(full)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read file"})
		return
	}
	list, sum := comments.Parse(string(data))
	if list == nil {
		list = []comments.Comment{}
	}
	c.JSON(http.StatusOK, CommentsResponse{
		File:     rel,
		Root:     name,
		Summary:  sum,
		Comments: list,
	})
}
