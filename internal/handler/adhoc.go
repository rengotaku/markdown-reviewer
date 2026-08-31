package handler

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"

	"markdown-reviewer/internal/files"
	"markdown-reviewer/internal/reviewstore"
)

// adhocRequest is the POST /api/adhoc body: one absolute path to a markdown
// file the caller wants to review right now.
type adhocRequest struct {
	Path string `json:"path"`
}

// Adhoc points the ad-hoc ("anonymous") root at one file that lives outside
// every configured root, and answers with the {root, rel} pair the web UI's
// deeplink needs (issue #240).
//
// The slot is deliberately volatile: it is never written to REVIEW_ROOTS or
// the launchd plist, it dies with the process, and taking it over for a new
// file first deletes the previous occupant's sidecar so old comments can't
// resurface under a path they don't belong to.
//
// A path that already sits inside a configured root is answered with that
// root instead — the slot is for files that have nowhere else to go, and
// hijacking it for a file the user could reach normally would drop them out
// of their file tree for no reason.
func (h *Handler) Adhoc(c *gin.Context) {
	if h.roots == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "review roots are not configured"})
		return
	}
	var req adhocRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "body must be {\"path\": \"/absolute/file.md\"}"})
		return
	}
	abs, err := canonicalMarkdownPath(req.Path)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if name, rel, ok := h.roots.Locate(abs); ok {
		c.JSON(http.StatusOK, gin.H{"root": name, "path": rel, "ephemeral": false})
		return
	}

	dir, base := filepath.Split(abs)
	dir = filepath.Clean(dir)

	// Re-opening the file the slot already holds keeps its comments: that is
	// the same review continuing, not a new one. Only a different file wipes.
	if resolver, ok := h.roots.Get(files.AdhocRootName); ok &&
		resolver.Root() == dir && resolver.OnlyBase() == base {
		c.JSON(http.StatusOK, gin.H{"root": files.AdhocRootName, "path": base, "ephemeral": true})
		return
	}

	if purgeErr := reviewstore.PurgeRoot(files.AdhocRootName); purgeErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": purgeErr.Error()})
		return
	}
	prev, err := h.roots.SetAdhoc(dir, base)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if h.onAdhocDir != nil {
		h.onAdhocDir(prev, dir)
	}
	c.JSON(http.StatusOK, gin.H{"root": files.AdhocRootName, "path": base, "ephemeral": true})
}

// AdhocCurrent reports which file the ad-hoc slot currently holds, without
// touching it. Read-back commands (`mr comments` / `review` / `reply` /
// `resolve`) use it to reach a file registered by an earlier `mr open`
// (issue #242): they must not re-register, because taking the slot over for
// a different file wipes the previous occupant's comments — a command whose
// job is to read would then silently destroy the review it was pointed at.
//
// 404 when the slot is empty, so the caller can say "run mr open first"
// instead of reporting a generic root mismatch.
func (h *Handler) AdhocCurrent(c *gin.Context) {
	if h.roots == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "review roots are not configured"})
		return
	}
	resolver, ok := h.roots.Get(files.AdhocRootName)
	if !ok || resolver.OnlyBase() == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "no one-off review is registered"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"root":      files.AdhocRootName,
		"dir":       resolver.Root(),
		"path":      resolver.OnlyBase(),
		"ephemeral": true,
	})
}

// canonicalMarkdownPath validates the requested path and returns it
// absolute and symlink-resolved. Requirements are deliberately narrow: an
// absolute path (the CLI knows the cwd, the server does not), an existing
// regular file, and a .md extension — the reviewer has nothing to show for
// anything else.
func canonicalMarkdownPath(raw string) (string, error) {
	p := strings.TrimSpace(raw)
	if p == "" {
		return "", errAdhoc("path is required")
	}
	if !filepath.IsAbs(p) {
		return "", errAdhoc("path must be absolute")
	}
	resolved, err := filepath.EvalSymlinks(p)
	if err != nil {
		if os.IsNotExist(err) {
			return "", errAdhoc("no such file: " + p)
		}
		return "", errAdhoc("resolve path: " + err.Error())
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return "", errAdhoc("stat path: " + err.Error())
	}
	if info.IsDir() {
		return "", errAdhoc("path is a directory; pass a single .md file")
	}
	if !strings.EqualFold(filepath.Ext(resolved), ".md") {
		return "", errAdhoc("only .md files can be reviewed")
	}
	return resolved, nil
}

type adhocError string

func (e adhocError) Error() string { return string(e) }

func errAdhoc(msg string) error { return adhocError(msg) }
