package handler

import (
	"errors"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"

	"markdown-reviewer/internal/files"
	"markdown-reviewer/internal/reviewstore"
)

// resolveRoot maps a root name ("" meaning the default root) to its resolver.
//
// Kept separate from pickResolver rather than shared: pickResolver's job is
// half the lookup and half the HTTP error mapping (500 when no roots are
// configured, 400 for an unknown name), and a batch entry can't use that —
// one unknown root must fail its own item, not the whole request.
func (h *Handler) resolveRoot(name string) (*files.Resolver, string, bool) {
	if h.roots == nil {
		return nil, "", false
	}
	if name == "" {
		def, defName := h.roots.Default()
		if def == nil {
			return nil, "", false
		}
		return def, defName, true
	}
	resolver, ok := h.roots.Get(name)
	if !ok {
		return nil, "", false
	}
	return resolver, name, true
}

// MaxStatBatchSize caps how many files one POST /api/stat/batch may ask about.
// The endpoint exists to collapse a per-tab request storm (issue #174: 191
// concurrent GET /api/stat in one second), and the client's tab count is
// user-controlled, so the server bounds the work per request rather than
// trusting it. Callers with more files than this split into several batches.
const MaxStatBatchSize = 500

// StatBatchTarget names one file to stat. Root may be empty, in which case
// the default root is used — same rule as the ?root= query param on the
// single-file endpoints.
type StatBatchTarget struct {
	Root string `json:"root"`
	Path string `json:"path"`
}

// StatBatchRequest is the body of POST /api/stat/batch.
type StatBatchRequest struct {
	Files []StatBatchTarget `json:"files"`
}

// Per-item error codes. Errors are reported per result rather than as an HTTP
// status because a batch routinely contains a mix of live and stale paths —
// the caller (the review-badge sweep) specifically needs to tell "this tab's
// file is gone" apart from "the request failed", which a single status code
// for the whole batch cannot express.
const (
	StatBatchErrNotFound   = "not_found"
	StatBatchErrBadRequest = "bad_request"
	StatBatchErrInternal   = "internal"
)

// StatBatchResult is one entry of the response, echoing back the requested
// root/path so the caller can match results without relying on ordering.
//
// Deliberately lighter than FileStatResponse: no sha, no timestamps. The only
// consumer is the review-badge sweep, which reads hasOpenComments and throws
// the rest away — and producing sha would mean reading every file's full
// contents (see StatFile), i.e. hundreds of whole-file reads per sweep.
// Callers that need sha/mtime for one file keep using GET /api/stat/*path.
type StatBatchResult struct {
	Root            string `json:"root"`
	Path            string `json:"path"`
	State           string `json:"state,omitempty"`
	Error           string `json:"error,omitempty"`
	HasOpenComments bool   `json:"hasOpenComments"`
}

// StatBatchResponse is the body returned by POST /api/stat/batch.
type StatBatchResponse struct {
	Results []StatBatchResult `json:"results"`
}

// StatFileBatch reports review state for many files in one request.
//
// This is the batched counterpart of StatFile. The frontend's review-badge
// sweep previously issued one GET per open tab in parallel, which saturates
// the browser's 6-connections-per-origin budget and pushes the active file's
// own body fetch behind the queue until it times out (issue #174).
func (h *Handler) StatFileBatch(c *gin.Context) {
	if h.roots == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "files API not configured"})
		return
	}

	var req StatBatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	if len(req.Files) > MaxStatBatchSize {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "too many files",
			"max":   MaxStatBatchSize,
		})
		return
	}

	// Sequential on purpose. The point of the endpoint is to remove
	// concurrency from the wire, and the work per file is a stat plus a
	// small sidecar read; fanning out goroutines here would trade the
	// browser's connection storm for a filesystem one without shortening
	// the response, which is bounded by total I/O either way.
	results := make([]StatBatchResult, 0, len(req.Files))
	for _, target := range req.Files {
		results = append(results, h.statBatchOne(target))
	}

	c.JSON(http.StatusOK, StatBatchResponse{Results: results})
}

// statBatchOne resolves and stats a single batch entry. It never writes to
// the gin context — every failure becomes an Error on the returned result, so
// one bad path can't abort the rest of the batch.
func (h *Handler) statBatchOne(target StatBatchTarget) StatBatchResult {
	rel := strings.TrimPrefix(target.Path, "/")
	// Echo the request's own root, including "" for "the default root", so
	// the caller can match results by the key it sent. The resolved name is
	// only used server-side for the sidecar lookup below.
	res := StatBatchResult{Root: target.Root, Path: filepath.ToSlash(rel)}

	if rel == "" || !strings.EqualFold(filepath.Ext(rel), markdownExt) {
		res.Error = StatBatchErrBadRequest
		return res
	}

	resolver, name, ok := h.resolveRoot(target.Root)
	if !ok {
		res.Error = StatBatchErrBadRequest
		return res
	}

	full, err := resolver.Resolve(rel)
	if err != nil {
		switch {
		case errors.Is(err, files.ErrPathTraversal), errors.Is(err, files.ErrInvalidPath):
			res.Error = StatBatchErrBadRequest
		case errors.Is(err, os.ErrNotExist):
			res.Error = StatBatchErrNotFound
		default:
			res.Error = StatBatchErrInternal
		}
		return res
	}

	if _, err := os.Stat(full); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			res.Error = StatBatchErrNotFound
		} else {
			res.Error = StatBatchErrInternal
		}
		return res
	}

	res.State = reviewState(name, filepath.ToSlash(rel))
	if res.State == "review" {
		hasOpen, err := reviewstore.HasOpenComments(name, filepath.ToSlash(rel))
		if err != nil {
			// Same posture as StatFile: a damaged sidecar downgrades the
			// badge rather than failing the entry, since the file itself
			// is demonstrably fine.
			slog.Warn("hasOpenComments check failed", "root", name, "path", rel, "err", err)
		} else {
			res.HasOpenComments = hasOpen
		}
	}
	return res
}
