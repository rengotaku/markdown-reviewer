package handler

import (
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"sort"
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
//
// Field order is GC-scan-friendly: the string (one pointer + length) lives
// before the slice header (one pointer + length + cap) so govet's
// fieldalignment doesn't complain.
type FileListResponse struct {
	Root  string      `json:"root"`
	Files []FileEntry `json:"files"`
}

// DirEntry is one entry in the /api/dirs listing.
type DirEntry struct {
	Name     string `json:"name"`
	Path     string `json:"path"`
	Type     string `json:"type"` // "dir" or "file"
	Modified string `json:"modified"`
}

// DirListResponse is the response body for GET /api/dirs.
//
// String before slice for the same reason as FileListResponse.
type DirListResponse struct {
	Root    string     `json:"root"`
	Entries []DirEntry `json:"entries"`
}

// FileReadResponse is the response body for GET /api/files/*path.
//
// Created is the platform-reported birth time (darwin) when available;
// empty string otherwise. Callers should treat an empty Created the same
// as "unknown" and fall back to Modified.
type FileReadResponse struct {
	Path     string `json:"path"`
	Content  string `json:"content"`
	Modified string `json:"modified"`
	Created  string `json:"created"`
	Root     string `json:"root"`
}

// FileStatResponse is the response body for GET /api/stat/*path. Returned
// without the file content so the frontend can cheaply poll for external
// changes on the currently open file.
type FileStatResponse struct {
	Path     string `json:"path"`
	Modified string `json:"modified"`
	Created  string `json:"created"`
	Root     string `json:"root"`
}

// fileTimes returns the RFC3339-UTC mtime and (best-effort) birth time
// strings for a given FileInfo. Created is empty when the platform does
// not record a birth time.
func fileTimes(info os.FileInfo) (modified, created string) {
	modified = info.ModTime().UTC().Format(time.RFC3339)
	if bt, ok := fileBirthTime(info); ok {
		created = bt.UTC().Format(time.RFC3339)
	}
	return modified, created
}

// FileWriteRequest is the request body for PUT /api/files/*path.
type FileWriteRequest struct {
	Content string `json:"content"`
}

// pickResolver returns the resolver matching the request's `?root=` query
// param. Empty / missing means "use the default (first) root". An unknown
// name surfaces a 400 so the client gets an obvious failure rather than
// silently falling back to the default.
func (h *Handler) pickResolver(c *gin.Context) (*files.Resolver, string, bool) {
	if h.roots == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "files API not configured"})
		return nil, "", false
	}
	name := c.Query("root")
	if name == "" {
		def, defName := h.roots.Default()
		if def == nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "no roots configured"})
			return nil, "", false
		}
		return def, defName, true
	}
	resolver, ok := h.roots.Get(name)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("unknown root %q", name)})
		return nil, "", false
	}
	return resolver, name, true
}

// ListFiles returns every .md file under the selected root.
func (h *Handler) ListFiles(c *gin.Context) {
	resolver, name, ok := h.pickResolver(c)
	if !ok {
		return
	}
	root := resolver.Root()
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
	c.JSON(http.StatusOK, FileListResponse{Files: entries, Root: name})
}

// noiseDirs is the set of directory names skipped in lazy listings. These are
// "obviously not source content" folders that would otherwise clutter the
// sidebar. Dotfiles are also skipped regardless.
var noiseDirs = map[string]struct{}{
	"node_modules": {},
	"vendor":       {},
	"tmp":          {},
	"bin":          {},
	"dist":         {},
	"build":        {},
	"target":       {},
}

// ListDir returns the immediate children (dirs + .md files) of
// <selected-root>/<path>. Used by the sidebar's lazy file tree. `path` is the
// query param; empty/missing means the root.
func (h *Handler) ListDir(c *gin.Context) {
	resolver, name, ok := h.pickResolver(c)
	if !ok {
		return
	}
	rel := strings.TrimPrefix(c.Query("path"), "/")
	rel = strings.TrimSuffix(rel, "/")

	full := resolver.Root()
	if rel != "" && rel != "." {
		resolved, err := resolver.Resolve(rel)
		if err != nil {
			switch {
			case errors.Is(err, files.ErrPathTraversal), errors.Is(err, files.ErrInvalidPath):
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			case errors.Is(err, os.ErrNotExist):
				c.JSON(http.StatusNotFound, gin.H{"error": "directory not found"})
			default:
				c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
			}
			return
		}
		full = resolved
		rel = filepath.ToSlash(rel)
	} else {
		rel = ""
	}

	info, err := os.Stat(full)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "directory not found"})
		return
	}
	if !info.IsDir() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "path is not a directory"})
		return
	}

	items, err := os.ReadDir(full)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read directory"})
		return
	}

	entries := []DirEntry{}
	for _, item := range items {
		itemName := item.Name()
		if strings.HasPrefix(itemName, ".") {
			continue
		}
		if item.IsDir() {
			if _, skip := noiseDirs[itemName]; skip {
				continue
			}
		}

		childRel := itemName
		if rel != "" {
			childRel = rel + "/" + itemName
		}

		var modified string
		if info, ierr := item.Info(); ierr == nil {
			modified = info.ModTime().UTC().Format(time.RFC3339)
		}

		switch {
		case item.IsDir():
			entries = append(entries, DirEntry{Name: itemName, Path: childRel, Type: "dir", Modified: modified})
		case strings.EqualFold(filepath.Ext(itemName), markdownExt):
			entries = append(entries, DirEntry{Name: itemName, Path: childRel, Type: "file", Modified: modified})
		}
	}

	// Group dirs above files, then sort each group by modified time
	// descending so the most recently-touched entries surface at the top.
	// Name is the tie-breaker (ascending) so the ordering is stable when
	// timestamps collide (e.g. fresh directories created in the same second).
	sort.SliceStable(entries, func(i, j int) bool {
		if entries[i].Type != entries[j].Type {
			return entries[i].Type == "dir"
		}
		if entries[i].Modified != entries[j].Modified {
			return entries[i].Modified > entries[j].Modified
		}
		return entries[i].Name < entries[j].Name
	})

	c.JSON(http.StatusOK, DirListResponse{Entries: entries, Root: name})
}

// ReadFile returns the content of <selected-root>/<path>.
func (h *Handler) ReadFile(c *gin.Context) {
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
	var modified, created string
	if info, ierr := os.Stat(full); ierr == nil {
		modified, created = fileTimes(info)
	}
	c.JSON(http.StatusOK, FileReadResponse{
		Path:     rel,
		Content:  string(data),
		Modified: modified,
		Created:  created,
		Root:     name,
	})
}

// StatFile returns just the modified timestamp for <selected-root>/<path> so
// the frontend can poll for external edits on the open file without
// re-transferring the body each tick.
func (h *Handler) StatFile(c *gin.Context) {
	full, rel, name, ok := h.resolveRequest(c)
	if !ok {
		return
	}
	info, err := os.Stat(full)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to stat file"})
		return
	}
	modified, created := fileTimes(info)
	c.JSON(http.StatusOK, FileStatResponse{
		Path:     rel,
		Modified: modified,
		Created:  created,
		Root:     name,
	})
}

// WriteFile saves the request body to <selected-root>/<path> atomically via
// tmp file + rename so a partial write never leaves a half-written .md on
// disk (rename(2) is atomic within the same filesystem).
func (h *Handler) WriteFile(c *gin.Context) {
	full, rel, name, ok := h.resolveRequest(c)
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

	var modified, created string
	if info, ierr := os.Stat(full); ierr == nil {
		modified, created = fileTimes(info)
	}
	c.JSON(http.StatusOK, FileReadResponse{
		Path:     rel,
		Content:  req.Content,
		Modified: modified,
		Created:  created,
		Root:     name,
	})
}

// resolveRequest pulls *path off the gin context, validates the .md
// extension, and resolves the path against the selected root. It writes the
// appropriate error response and returns ok=false on any failure so the
// callers can early-return without duplicating the boilerplate.
func (h *Handler) resolveRequest(c *gin.Context) (full, rel, name string, ok bool) {
	resolver, name, ok := h.pickResolver(c)
	if !ok {
		return "", "", "", false
	}
	rel = strings.TrimPrefix(c.Param("path"), "/")
	if rel == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "path required"})
		return "", "", "", false
	}
	if !strings.EqualFold(filepath.Ext(rel), markdownExt) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "only .md files supported"})
		return "", "", "", false
	}
	full, err := resolver.Resolve(rel)
	if err != nil {
		switch {
		case errors.Is(err, files.ErrPathTraversal), errors.Is(err, files.ErrInvalidPath):
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		case errors.Is(err, os.ErrNotExist):
			c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		}
		return "", "", "", false
	}
	return full, filepath.ToSlash(rel), name, true
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
