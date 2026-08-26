package files

import (
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
)

// reservedRootNames are top-level URL path segments the server already owns
// — the Gin route groups in internal/handler/handler.go (`/health`, `/api/*`)
// and the static SPA bundle's own top-level entries (internal/static/dist/).
// A root sharing one of these names would make the Web UI's `/{root}/{path}`
// deeplinks (see EditorPage's `/:root/*` route) collide with those routes:
// e.g. a root named "api" turns `/api/foo.md` into a request the `/api`
// group swallows before it ever reaches the SPA, returning JSON instead of
// rendering the editor. Comparison is case-insensitive since HTTP routing
// on this server (and most reverse proxies in front of it) doesn't
// distinguish case in the path.
var reservedRootNames = map[string]bool{
	"api":         true,
	"health":      true,
	"assets":      true,
	"index.html":  true,
	"logo.png":    true,
	"favicon.svg": true,
}

// RootSpec is one entry parsed out of the REVIEW_ROOTS env var. Name is the
// user-facing label (tab title); Path is the directory the resolver will be
// rooted at.
//
// AllowSymlinkHub opts this root into hub mode: direct symlink children of
// Path are trusted as implicit sub-roots. See Options.AllowSymlinkHub for
// the exact semantics. Defaults to false to preserve the strict behavior.
type RootSpec struct {
	Name            string `json:"name"`
	Path            string `json:"path"`
	AllowSymlinkHub bool   `json:"allow_symlink_hub,omitempty"`
}

// Root pairs a user-facing name with a configured Resolver.
type Root struct {
	Resolver *Resolver
	Name     string
}

// Roots is an ordered set of named Resolvers exposed by the files API. The
// first entry is the default returned when a request omits the root selector.
type Roots struct {
	byName map[string]*Root
	order  []*Root
}

// NewRoots builds a Roots from the given specs. Each spec produces a Resolver
// (so path-traversal protection is per-root). Names must be non-empty,
// unique, and contain no path separator so they're safe to surface in URLs
// and JSON without further encoding.
func NewRoots(specs []RootSpec) (*Roots, error) {
	if len(specs) == 0 {
		return nil, errors.New("at least one root is required")
	}
	r := &Roots{byName: make(map[string]*Root, len(specs))}
	for _, spec := range specs {
		if spec.Name == "" {
			return nil, errors.New("root name is empty")
		}
		if spec.Name != filepath.Base(spec.Name) || spec.Name == "." || spec.Name == ".." {
			return nil, fmt.Errorf("root name %q must not contain path separators", spec.Name)
		}
		if reservedRootNames[strings.ToLower(spec.Name)] {
			return nil, fmt.Errorf("root name %q is reserved by the server (conflicts with a built-in route or static asset); choose a different name", spec.Name)
		}
		if _, dup := r.byName[spec.Name]; dup {
			return nil, fmt.Errorf("duplicate root name %q", spec.Name)
		}
		resolver, err := NewResolverWithOptions(spec.Path, Options{
			AllowSymlinkHub: spec.AllowSymlinkHub,
		})
		if err != nil {
			return nil, fmt.Errorf("init resolver for root %q: %w", spec.Name, err)
		}
		root := &Root{Name: spec.Name, Resolver: resolver}
		r.byName[spec.Name] = root
		r.order = append(r.order, root)
	}
	return r, nil
}

// Get returns the resolver for the named root and ok=true, or nil/false when
// no such root exists.
func (r *Roots) Get(name string) (*Resolver, bool) {
	if r == nil {
		return nil, false
	}
	root, ok := r.byName[name]
	if !ok {
		return nil, false
	}
	return root.Resolver, true
}

// Default returns the first-configured root's resolver and name. Callers use
// this when a request omits the `?root=` selector.
func (r *Roots) Default() (*Resolver, string) {
	if r == nil || len(r.order) == 0 {
		return nil, ""
	}
	d := r.order[0]
	return d.Resolver, d.Name
}

// List returns the configured roots in declaration order. Used by the
// /api/config endpoint so the UI can render the root-tab bar.
func (r *Roots) List() []Root {
	if r == nil {
		return nil
	}
	out := make([]Root, len(r.order))
	for i, root := range r.order {
		out[i] = *root
	}
	return out
}

// ParseRootsJSON parses the REVIEW_ROOTS env value, which is a JSON array of
// {name, path} objects. Returns the parsed specs in declaration order.
func ParseRootsJSON(raw string) ([]RootSpec, error) {
	var specs []RootSpec
	if err := json.Unmarshal([]byte(raw), &specs); err != nil {
		return nil, fmt.Errorf("parse REVIEW_ROOTS JSON: %w", err)
	}
	if len(specs) == 0 {
		return nil, errors.New("REVIEW_ROOTS contains no entries")
	}
	return specs, nil
}
