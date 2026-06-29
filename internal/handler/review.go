package handler

import (
	"net/http"
	"os"

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
