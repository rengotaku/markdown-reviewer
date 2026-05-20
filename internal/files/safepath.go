// Package files contains the safe-path resolver used by the files API to
// reject any path that escapes REVIEW_ROOT (directly, via "..", or via a
// symlink that points outside the root).
package files

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

var (
	// ErrPathTraversal is returned when a user-supplied path resolves
	// outside the configured root.
	ErrPathTraversal = errors.New("path escapes review root")
	// ErrInvalidPath is returned when a user-supplied path is empty or
	// otherwise malformed.
	ErrInvalidPath = errors.New("invalid path")
)

// Resolver resolves user-supplied relative paths against an absolute,
// symlink-resolved root. All API access goes through Resolver so the
// "stay inside the root" invariant lives in exactly one place.
type Resolver struct {
	root string
}

// NewResolver creates a Resolver rooted at root. The root must exist.
//
// The root is resolved to an absolute, symlink-free path up-front so the
// later per-request checks can do a simple prefix comparison without
// re-walking symlinks for the root itself on every request.
func NewResolver(root string) (*Resolver, error) {
	if root == "" {
		return nil, errors.New("root is empty")
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, fmt.Errorf("resolve root: %w", err)
	}
	resolved, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return nil, fmt.Errorf("resolve root symlinks: %w", err)
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return nil, fmt.Errorf("stat root: %w", err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("root %q is not a directory", resolved)
	}
	return &Resolver{root: resolved}, nil
}

// Root returns the absolute, symlink-resolved root directory.
func (r *Resolver) Root() string { return r.root }

// Resolve maps a user-supplied relative path to an absolute path inside
// Root. It returns ErrPathTraversal if the path escapes Root (via "..",
// absolute path, or a symlink pointing outside) and ErrInvalidPath if the
// path is empty or names the root itself.
//
// For existing files the result is the symlink-resolved absolute path;
// for non-existing targets (new files being written) the parent directory
// is symlink-resolved and the basename is appended.
func (r *Resolver) Resolve(rel string) (string, error) {
	rel = strings.TrimPrefix(rel, "/")
	if rel == "" {
		return "", ErrInvalidPath
	}
	if filepath.IsAbs(rel) {
		return "", ErrPathTraversal
	}
	cleaned := filepath.Clean(rel)
	if cleaned == "." {
		return "", ErrInvalidPath
	}
	if cleaned == ".." || strings.HasPrefix(cleaned, ".."+string(filepath.Separator)) {
		return "", ErrPathTraversal
	}

	full := filepath.Join(r.root, cleaned)
	if !withinRoot(r.root, full) {
		return "", ErrPathTraversal
	}

	resolved, err := filepath.EvalSymlinks(full)
	if err == nil {
		if !withinRoot(r.root, resolved) {
			return "", ErrPathTraversal
		}
		return resolved, nil
	}
	if !os.IsNotExist(err) {
		return "", fmt.Errorf("resolve symlinks: %w", err)
	}

	// Non-existing target: validate the parent so a `write` that creates a
	// new file still can't escape via a symlinked parent directory.
	parent := filepath.Dir(full)
	parentResolved, perr := filepath.EvalSymlinks(parent)
	if perr != nil {
		if os.IsNotExist(perr) {
			return "", os.ErrNotExist
		}
		return "", fmt.Errorf("resolve parent: %w", perr)
	}
	if !withinRoot(r.root, parentResolved) {
		return "", ErrPathTraversal
	}
	return filepath.Join(parentResolved, filepath.Base(full)), nil
}

// withinRoot returns true when p is root or sits anywhere inside it.
// We rely on filepath.Rel because both paths are already absolute and
// cleaned, so any escape shows up as a "..\..." prefix in the relative.
func withinRoot(root, p string) bool {
	rel, err := filepath.Rel(root, p)
	if err != nil {
		return false
	}
	if rel == "." {
		return true
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return false
	}
	return true
}
