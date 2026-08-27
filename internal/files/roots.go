package files

import (
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
)

// AdhocRootName is the single reserved slot used for one-off reviews of a
// file that lives outside every configured root (issue #240). There is
// exactly one such slot: registering a second file replaces the first.
// The name is fixed (rather than generated per file) so the deeplink and
// the sidecar location are predictable, and it is listed in
// reservedRootNames so a REVIEW_ROOTS entry can never collide with it.
const AdhocRootName = "anonymous"

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
	AdhocRootName: true,
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
	// Ephemeral marks the ad-hoc slot: it is not persisted anywhere, dies
	// with the process, and the UI renders it without a file tree.
	Ephemeral bool
}

// Roots is an ordered set of named Resolvers exposed by the files API. The
// first entry is the default returned when a request omits the root selector.
// Roots is mutated at runtime by SetAdhoc while handlers read it
// concurrently, so every accessor takes mu.
type Roots struct {
	byName map[string]*Root
	order  []*Root
	mu     sync.RWMutex
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
	r.mu.RLock()
	defer r.mu.RUnlock()
	root, ok := r.byName[name]
	if !ok {
		return nil, false
	}
	return root.Resolver, true
}

// Default returns the first-configured root's resolver and name. Callers use
// this when a request omits the `?root=` selector.
func (r *Roots) Default() (*Resolver, string) {
	if r == nil {
		return nil, ""
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	if len(r.order) == 0 {
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
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]Root, len(r.order))
	for i, root := range r.order {
		out[i] = *root
	}
	return out
}

// SetAdhoc points the ad-hoc slot at base inside dir, replacing whatever it
// held before. The resolver is narrowed to that one file (Options.OnlyBase)
// so the slot never widens write access to dir's other entries. Returns the
// directory the slot pointed at previously ("" when it was empty) so the
// caller can move its file watch across.
//
// The slot is appended last and Default() only ever returns order[0], so a
// request that omits ?root= can't accidentally land here.
func (r *Roots) SetAdhoc(dir, base string) (string, error) {
	if r == nil {
		return "", errors.New("files API is not configured")
	}
	resolver, err := NewResolverWithOptions(dir, Options{OnlyBase: base})
	if err != nil {
		return "", fmt.Errorf("init ad-hoc resolver: %w", err)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	prev := ""
	if existing, ok := r.byName[AdhocRootName]; ok {
		prev = existing.Resolver.Root()
		existing.Resolver = resolver
		return prev, nil
	}
	root := &Root{Name: AdhocRootName, Resolver: resolver, Ephemeral: true}
	r.byName[AdhocRootName] = root
	r.order = append(r.order, root)
	return prev, nil
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

// Locate finds the non-ephemeral root that contains abs (an absolute,
// symlink-resolved path) and returns its name plus abs's forward-slash path
// relative to it. The ad-hoc slot is skipped on purpose: callers use Locate
// to decide whether a file needs the slot at all, and a slot hit would make
// that decision circular.
func (r *Roots) Locate(abs string) (name, rel string, ok bool) {
	if r == nil {
		return "", "", false
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, root := range r.order {
		if root.Ephemeral {
			continue
		}
		base := root.Resolver.Root()
		relPath, err := filepath.Rel(base, abs)
		if err != nil {
			continue
		}
		if relPath == "." || relPath == ".." || strings.HasPrefix(relPath, ".."+string(filepath.Separator)) {
			continue
		}
		return root.Name, filepath.ToSlash(relPath), true
	}
	return "", "", false
}
