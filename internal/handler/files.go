package handler

import (
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"markdown-reviewer/internal/files"
	"markdown-reviewer/internal/reviewstore"
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
	// State is the managed-review lifecycle state: "draft" (not ingested) or
	// "review" (ingested — has an entry under ~/.config/reviewer).
	State string `json:"state"`
	// Sha is the sha256 hex digest of Content's exact bytes. mtime alone
	// (second precision) can't distinguish two different saves within the
	// same second; the content hash always can (issue #119).
	Sha string `json:"sha"`
}

// FileStatResponse is the response body for GET /api/stat/*path. Returned
// without the file content so the frontend can cheaply poll for external
// changes on the currently open file.
type FileStatResponse struct {
	Path     string `json:"path"`
	Modified string `json:"modified"`
	Created  string `json:"created"`
	Root     string `json:"root"`
	State    string `json:"state"`
	// Sha is the sha256 hex digest of the file's current on-disk bytes. See
	// FileReadResponse.Sha for why mtime alone isn't enough.
	Sha             string `json:"sha"`
	HasOpenComments bool   `json:"hasOpenComments"`
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
		State:    reviewState(name, rel),
		Sha:      files.Sha256Hex(data),
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
	// Files under review are small local markdown, so re-reading the whole
	// body for its hash on every stat poll is cheap — no caching needed.
	// The file can vanish between the Stat above and this ReadFile (a
	// delete racing this request); statReadFileError maps that the same
	// way the Stat's own not-found branch above does, instead of
	// surfacing it as a 500.
	data, err := os.ReadFile(full)
	if err != nil {
		statReadFileError(c, err)
		return
	}
	modified, created := fileTimes(info)
	state := reviewState(name, rel)
	hasOpen := false
	if state == "review" {
		if ok, err := reviewstore.HasOpenComments(name, rel); err != nil {
			slog.Warn("hasOpenComments check failed", "root", name, "path", rel, "err", err)
		} else {
			hasOpen = ok
		}
	}
	c.JSON(http.StatusOK, FileStatResponse{
		Path:            rel,
		Modified:        modified,
		Created:         created,
		Root:            name,
		State:           state,
		Sha:             files.Sha256Hex(data),
		HasOpenComments: hasOpen,
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

	// Serialize the read-check(If-Match)-then-write section per resolved
	// path: without this, two concurrent PUTs for the same file can both
	// read the same "old" content, both pass the If-Match comparison, and
	// the second write silently clobbers the first (issue #119 case 5 is
	// only actually closed once concurrent writers can't race the check).
	// Locking is per-path (not a single global mutex) so concurrent writes
	// to *different* files still proceed in parallel; the lock is held from
	// this read through the atomicWrite below.
	unlock := h.lockPath(full)
	defer unlock()

	// Read the about-to-be-overwritten content once; it feeds the If-Match
	// conflict check below, the revision snapshot, and the re-anchor diff.
	oldRaw, oldErr := os.ReadFile(full)

	// Optional conflict detection (issue #119): a client that read the file
	// via GET /api/files or /api/stat can send back that response's sha as
	// If-Match. If the file changed on disk since then (including a
	// same-second double-save mtime can't catch), reject the write instead
	// of silently overwriting the other change. No header at all preserves
	// the historical last-write-wins behavior for the mr CLI and any other
	// caller that never opted in.
	if ifMatch, hasIfMatch := ifMatchHeaderValue(c); hasIfMatch {
		currentSha := ""
		if oldErr == nil {
			currentSha = files.Sha256Hex(oldRaw)
		}
		if currentSha != ifMatch {
			modified := ""
			if info, ierr := os.Stat(full); ierr == nil {
				modified, _ = fileTimes(info)
			}
			c.JSON(http.StatusPreconditionFailed, gin.H{
				"error":    "file changed on disk",
				"sha":      currentSha,
				"modified": modified,
			})
			return
		}
	}

	// Auto-ingest on save: a save is a stronger signal of intent than merely
	// opening a file, so put it under review here (unlike PR #70/#71, which
	// only ingested on the first comment). Without this the AppendRevision
	// below no-ops for draft files and no diff history ever accrues for files
	// the user edits but never comments on. Ingest is idempotent and must
	// never block the save — log and continue.
	if oldErr == nil {
		if ierr := reviewstore.Ingest(name, rel); ierr != nil {
			slog.Warn("auto-ingest on save failed", "root", name, "path", rel, "err", ierr)
		}
	}

	// Snapshot the about-to-be-overwritten content into revision history
	// before the atomic rename destroys it. Strip the AI hint first so the
	// per-save hint churn never pollutes a diff. AppendRevision no-ops for
	// draft (un-ingested) files, so only managed files accrue history. A
	// snapshot failure must never block the save — log and continue.
	if oldErr == nil {
		snap := reviewstore.StripAIHint(string(oldRaw))
		if _, _, aerr := reviewstore.AppendRevision(name, rel, c.Query("author"), snap); aerr != nil {
			slog.Warn("revision snapshot failed", "root", name, "path", rel, "err", aerr)
		}
	}

	// Force-inject the AI hint comment so AI clients reading this file
	// can self-discover the comment-extraction API. Replacing instead of
	// appending keeps the block unique across save cycles.
	hint := buildAIHint(deriveBaseURL(c.Request), rel, name)
	content := injectAIHint(req.Content, hint)

	// Re-anchor comments that would orphan under this edit. The old/new bodies
	// fed to the re-anchor diff must be normalized exactly like the GET path
	// (readCanonical) resolves anchors — readCanonical returns the raw file
	// bytes verbatim, so we pass the raw old bytes and the raw new content
	// (both still carry the AI hint block).
	//
	// Order is deliberate: compute + persist review.json BEFORE writing the
	// body. A strict two-phase commit is unnecessary. If the write below fails,
	// review.json may transiently point at the not-yet-written body; the client
	// retries the same PUT and the (idempotent) re-anchor converges — on retry
	// the moved anchors already resolve against the identical new content, so
	// ReanchorOnSave is a no-op and the eventual successful write makes disk +
	// review.json consistent. A re-anchor failure must never block the save —
	// mirror the revision snapshot's "saving is never blocked" policy.
	if oldErr == nil {
		if _, rerr := reviewstore.ReanchorOnSave(name, rel, string(oldRaw), content); rerr != nil {
			slog.Warn("reanchor on save failed", "root", name, "path", rel, "err", rerr)
		}
	}

	if err := atomicWrite(full, []byte(content)); err != nil {
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
		Content:  content,
		Modified: modified,
		Created:  created,
		Root:     name,
		State:    reviewState(name, rel),
		Sha:      files.Sha256Hex([]byte(content)),
	})
}

// statReadFileError classifies the error from StatFile's post-Stat
// os.ReadFile call (done to compute the sha) and writes the matching JSON
// response. A file that vanished between the earlier os.Stat and this read
// — a delete racing the request — reports os.ErrNotExist just like a
// directly-missing file would, so it's mapped to 404 exactly like the
// Stat's own not-found branch instead of leaking through as a 500.
// Extracted into its own function so the classification can be unit tested
// directly (see files_internal_test.go) without needing to reproduce the
// actual Stat/ReadFile race, which is a few nanoseconds wide and not
// reliably triggerable from a test.
func statReadFileError(c *gin.Context, err error) {
	if errors.Is(err, os.ErrNotExist) {
		c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
		return
	}
	c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to stat file"})
}

// lockPath acquires (creating on first use) the per-path mutex guarding
// WriteFile's read-check-then-write section for the given resolved path,
// and returns a func to release it. Entries are never evicted from
// writeLocks, but that's acceptable here: this is a local, single-user
// review tool, and the set of distinct files ever written over a server's
// lifetime is small and bounded by the reviewed markdown tree, so the
// long-lived *sync.Mutex per path never accumulates into a real leak.
func (h *Handler) lockPath(path string) (unlock func()) {
	muAny, _ := h.writeLocks.LoadOrStore(path, &sync.Mutex{})
	mu, _ := muAny.(*sync.Mutex)
	mu.Lock()
	return mu.Unlock
}

// ifMatchHeaderValue extracts the sha256-hex precondition value from the
// request's If-Match header for PUT /api/files/*path. Tolerates a
// surrounding pair of double quotes (the ETag-style quoting some HTTP
// clients add automatically) in addition to a plain hex string. ok is false
// when the header is absent, letting WriteFile distinguish "no precondition
// requested" (legacy last-write-wins) from an empty precondition value.
func ifMatchHeaderValue(c *gin.Context) (sha string, ok bool) {
	raw := strings.TrimSpace(c.GetHeader("If-Match"))
	if raw == "" {
		return "", false
	}
	if len(raw) >= 2 && raw[0] == '"' && raw[len(raw)-1] == '"' {
		raw = raw[1 : len(raw)-1]
	}
	return raw, true
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
