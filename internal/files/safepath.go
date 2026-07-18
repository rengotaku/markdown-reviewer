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

// Options tunes Resolver behavior. Zero value keeps the strict default:
// any symlink whose target lands outside root is rejected.
type Options struct {
	// AllowSymlinkHub trusts symlinks that appear as *direct children* of
	// root, treating each such link's target as an implicit sub-root.
	// Deeper symlinks (or a hub-child that isn't itself a symlink) still
	// escape and are still rejected. Intended for hub layouts like
	// ~/code/<repo> -> ~/Workspace/<repo>/main where root is a flat index
	// of per-repo symlinks by design.
	AllowSymlinkHub bool
}

// Resolver resolves user-supplied relative paths against an absolute,
// symlink-resolved root. All API access goes through Resolver so the
// "stay inside the root" invariant lives in exactly one place.
type Resolver struct {
	root string
	opts Options
}

// NewResolver creates a Resolver rooted at root with default (strict)
// options. See NewResolverWithOptions for the opt-in modes.
func NewResolver(root string) (*Resolver, error) {
	return NewResolverWithOptions(root, Options{})
}

// NewResolverWithOptions creates a Resolver rooted at root. The root must
// exist.
//
// The root is resolved to an absolute, symlink-free path up-front so the
// later per-request checks can do a simple prefix comparison without
// re-walking symlinks for the root itself on every request.
func NewResolverWithOptions(root string, opts Options) (*Resolver, error) {
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
	return &Resolver{root: resolved, opts: opts}, nil
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
		if !r.withinAllowedRoots(cleaned, resolved) {
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
	if !r.withinAllowedRoots(cleaned, parentResolved) {
		return "", ErrPathTraversal
	}
	return filepath.Join(parentResolved, filepath.Base(full)), nil
}

// withinAllowedRoots reports whether resolved is inside the primary root
// or, when AllowSymlinkHub is on, inside the target of the first-component
// symlink child. `cleaned` is the caller's already-cleaned relative path
// (used to identify the first component; never re-joined with root).
func (r *Resolver) withinAllowedRoots(cleaned, resolved string) bool {
	if withinRoot(r.root, resolved) {
		return true
	}
	if !r.opts.AllowSymlinkHub {
		return false
	}
	subRoot, ok := r.hubSubRoot(cleaned)
	if !ok {
		return false
	}
	return withinRoot(subRoot, resolved)
}

// hubSubRoot returns the resolved target of `cleaned`'s first path
// component when that component is a direct symlink child of root
// pointing at an existing directory. Anything else (regular dir, missing
// entry, symlink to a file, deeper path) returns ok=false so the strict
// path stays in charge.
func (r *Resolver) hubSubRoot(cleaned string) (string, bool) {
	first := cleaned
	if idx := strings.IndexRune(cleaned, filepath.Separator); idx >= 0 {
		first = cleaned[:idx]
	}
	if first == "" || first == "." || first == ".." {
		return "", false
	}
	childPath := filepath.Join(r.root, first)
	linkInfo, err := os.Lstat(childPath)
	if err != nil || linkInfo.Mode()&os.ModeSymlink == 0 {
		return "", false
	}
	target, err := filepath.EvalSymlinks(childPath)
	if err != nil {
		return "", false
	}
	targetInfo, err := os.Stat(target)
	if err != nil || !targetInfo.IsDir() {
		return "", false
	}
	return target, true
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
