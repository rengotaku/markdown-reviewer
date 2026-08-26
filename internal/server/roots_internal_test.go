package server

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// tempRoot returns an existing tmpdir with its symlink-resolved absolute path
// — matching what files.NewResolver normalizes to internally, so equality
// assertions line up.
func tempRoot(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	resolved, err := filepath.EvalSymlinks(root)
	require.NoError(t, err)
	return resolved
}

func TestBuildRoots_ReviewRootsWinsOverReviewRoot(t *testing.T) {
	a := tempRoot(t)
	b := tempRoot(t)

	roots, err := buildRoots(Config{
		ReviewRoots: `[{"name":"works","path":"` + a + `"},{"name":"rooms","path":"` + b + `"}]`,
		ReviewRoot:  "/should/be/ignored",
	})
	require.NoError(t, err)
	require.NotNil(t, roots)

	list := roots.List()
	require.Len(t, list, 2)
	assert.Equal(t, "works", list[0].Name)
	assert.Equal(t, a, list[0].Resolver.Root())
	assert.Equal(t, "rooms", list[1].Name)
	assert.Equal(t, b, list[1].Resolver.Root())
}

func TestBuildRoots_LegacyReviewRootFallback(t *testing.T) {
	a := tempRoot(t)

	roots, err := buildRoots(Config{ReviewRoot: a})
	require.NoError(t, err)
	require.NotNil(t, roots)

	list := roots.List()
	require.Len(t, list, 1)
	assert.Equal(t, filepath.Base(a), list[0].Name, "legacy single-root uses basename as tab name")
	assert.Equal(t, a, list[0].Resolver.Root())
}

func TestBuildRoots_BothEmptyReturnsNil(t *testing.T) {
	roots, err := buildRoots(Config{})
	require.NoError(t, err)
	assert.Nil(t, roots, "neither REVIEW_ROOTS nor REVIEW_ROOT → files API disabled")
}

func TestBuildRoots_MalformedReviewRoots(t *testing.T) {
	_, err := buildRoots(Config{ReviewRoots: `not json`})
	require.Error(t, err)
}

func TestBuildRoots_ReviewRootsPointsToMissingDir(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "does-not-exist")
	_, err := buildRoots(Config{
		ReviewRoots: `[{"name":"x","path":"` + missing + `"}]`,
	})
	require.Error(t, err)
}

// #236 codex review: a root named after a server-owned top-level route
// (/api, /health) or a static SPA asset would make /{root}/{path} deeplinks
// collide with those routes instead of reaching the SPA.
func TestBuildRoots_ReviewRootsWithReservedName(t *testing.T) {
	a := tempRoot(t)
	_, err := buildRoots(Config{
		ReviewRoots: `[{"name":"api","path":"` + a + `"}]`,
	})
	require.Error(t, err)
}

func TestBuildRoots_LegacyReviewRootWithReservedBasename(t *testing.T) {
	// The legacy REVIEW_ROOT path funnels through the same files.NewRoots
	// validation via its basename — a directory literally named "api" must
	// be rejected the same way an explicit REVIEW_ROOTS name would be.
	parent := t.TempDir()
	reserved := filepath.Join(parent, "api")
	require.NoError(t, os.MkdirAll(reserved, 0o755))

	_, err := buildRoots(Config{ReviewRoot: reserved})
	require.Error(t, err)
}
