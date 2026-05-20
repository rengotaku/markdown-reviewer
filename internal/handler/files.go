package handler

import (
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"markdown-reviewer/internal/files"
)

const markdownExt = ".md"

// FileEntry is one entry in the /api/files listing.
//
// Field order groups pointer-containing fields (strings) together so the
// govet fieldalignment check is happy — non-pointer fields (Size) come
// after.
type FileEntry struct {
	Path     string `json:"path"`
	Modified string `json:"modified"`
	Size     int64  `json:"size"`
}

// FileListResponse is the response body for GET /api/files.
type FileListResponse struct {
	Files []FileEntry `json:"files"`
}

// FileReadResponse is the response body for GET /api/files/*path.
type FileReadResponse struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

// FileWriteRequest is the request body for PUT /api/files/*path.
type FileWriteRequest struct {
	Content string `json:"content"`
}

// ListFiles returns every .md file under REVIEW_ROOT.
func (h *Handler) ListFiles(c *gin.Context) {
	if h.resolver == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "files API not configured"})
		return
	}
	root := h.resolver.Root()
	entries := []FileEntry{}
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		if !strings.EqualFold(filepath.Ext(d.Name()), markdownExt) {
			return nil
		}
		info, ierr := d.Info()
		if ierr != nil {
			return ierr
		}
		rel, rerr := filepath.Rel(root, path)
		if rerr != nil {
			return rerr
		}
		entries = append(entries, FileEntry{
			Path:     filepath.ToSlash(rel),
			Size:     info.Size(),
			Modified: info.ModTime().UTC().Format(time.RFC3339),
		})
		return nil
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list files"})
		return
	}
	c.JSON(http.StatusOK, FileListResponse{Files: entries})
}

// ReadFile returns the content of REVIEW_ROOT/<path>.
func (h *Handler) ReadFile(c *gin.Context) {
	full, rel, ok := h.resolveRequest(c)
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
	c.JSON(http.StatusOK, FileReadResponse{Path: rel, Content: string(data)})
}

// WriteFile saves the request body to REVIEW_ROOT/<path> atomically via
// tmp file + rename so a partial write never leaves a half-written .md
// on disk (rename(2) is atomic within the same filesystem).
func (h *Handler) WriteFile(c *gin.Context) {
	full, rel, ok := h.resolveRequest(c)
	if !ok {
		return
	}

	var req FileWriteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	if err := atomicWrite(full, []byte(req.Content)); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			c.JSON(http.StatusNotFound, gin.H{"error": "parent directory does not exist"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to write file"})
		return
	}

	c.JSON(http.StatusOK, FileReadResponse{Path: rel, Content: req.Content})
}

// resolveRequest pulls *path off the gin context, validates the .md
// extension, and resolves the path against REVIEW_ROOT. It writes the
// appropriate error response and returns ok=false on any failure so the
// callers can early-return without duplicating the boilerplate.
func (h *Handler) resolveRequest(c *gin.Context) (full, rel string, ok bool) {
	if h.resolver == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "files API not configured"})
		return "", "", false
	}
	rel = strings.TrimPrefix(c.Param("path"), "/")
	if rel == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "path required"})
		return "", "", false
	}
	if !strings.EqualFold(filepath.Ext(rel), markdownExt) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "only .md files supported"})
		return "", "", false
	}
	full, err := h.resolver.Resolve(rel)
	if err != nil {
		switch {
		case errors.Is(err, files.ErrPathTraversal), errors.Is(err, files.ErrInvalidPath):
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		case errors.Is(err, os.ErrNotExist):
			c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		}
		return "", "", false
	}
	return full, filepath.ToSlash(rel), true
}

// atomicWrite writes data to a temp file in the same directory and renames
// it over target. The temp file lives next to target (not in /tmp) because
// rename across filesystems is not atomic, and EXDEV would force a copy
// that defeats the whole point of the dance.
func atomicWrite(target string, data []byte) error {
	dir := filepath.Dir(target)
	tmp, err := os.CreateTemp(dir, ".tmp-mr-*")
	if err != nil {
		return fmt.Errorf("create temp: %w", err)
	}
	tmpPath := tmp.Name()
	committed := false
	defer func() {
		if !committed {
			_ = os.Remove(tmpPath)
		}
	}()

	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("write temp: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("sync temp: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close temp: %w", err)
	}
	if err := os.Rename(tmpPath, target); err != nil {
		return fmt.Errorf("rename: %w", err)
	}
	committed = true
	return nil
}
