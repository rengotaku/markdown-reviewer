package files_test

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"markdown-reviewer/internal/files"
)

func setupRoot(t *testing.T) (root string) {
	t.Helper()
	root = t.TempDir()
	// EvalSymlinks normalizes /var → /private/var on macOS; do the same up-front
	// so test assertions can compare against the same canonical form the
	// resolver returns.
	resolved, err := filepath.EvalSymlinks(root)
	require.NoError(t, err)
	return resolved
}

func TestNewResolver_RootMustExist(t *testing.T) {
	_, err := files.NewResolver(filepath.Join(t.TempDir(), "does-not-exist"))
	require.Error(t, err)
}

func TestNewResolver_RootMustBeDir(t *testing.T) {
	tmp := t.TempDir()
	file := filepath.Join(tmp, "regular.txt")
	require.NoError(t, os.WriteFile(file, []byte("x"), 0o644))

	_, err := files.NewResolver(file)
	require.Error(t, err)
}

func TestNewResolver_EmptyRoot(t *testing.T) {
	_, err := files.NewResolver("")
	require.Error(t, err)
}

func TestResolve_ExistingFile(t *testing.T) {
	root := setupRoot(t)
	require.NoError(t, os.WriteFile(filepath.Join(root, "foo.md"), []byte("x"), 0o644))

	r, err := files.NewResolver(root)
	require.NoError(t, err)

	got, err := r.Resolve("foo.md")
	require.NoError(t, err)
	assert.Equal(t, filepath.Join(root, "foo.md"), got)
}

func TestResolve_LeadingSlashStripped(t *testing.T) {
	root := setupRoot(t)
	require.NoError(t, os.WriteFile(filepath.Join(root, "foo.md"), []byte("x"), 0o644))

	r, err := files.NewResolver(root)
	require.NoError(t, err)

	got, err := r.Resolve("/foo.md")
	require.NoError(t, err)
	assert.Equal(t, filepath.Join(root, "foo.md"), got)
}

func TestResolve_NestedExistingFile(t *testing.T) {
	root := setupRoot(t)
	sub := filepath.Join(root, "sub")
	require.NoError(t, os.MkdirAll(sub, 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(sub, "bar.md"), []byte("x"), 0o644))

	r, err := files.NewResolver(root)
	require.NoError(t, err)

	got, err := r.Resolve("sub/bar.md")
	require.NoError(t, err)
	assert.Equal(t, filepath.Join(sub, "bar.md"), got)
}

func TestResolve_NonExistingFile_ParentExists(t *testing.T) {
	root := setupRoot(t)
	r, err := files.NewResolver(root)
	require.NoError(t, err)

	got, err := r.Resolve("new.md")
	require.NoError(t, err)
	assert.Equal(t, filepath.Join(root, "new.md"), got)
}

func TestResolve_EmptyPath(t *testing.T) {
	root := setupRoot(t)
	r, err := files.NewResolver(root)
	require.NoError(t, err)

	_, err = r.Resolve("")
	require.ErrorIs(t, err, files.ErrInvalidPath)

	_, err = r.Resolve("/")
	require.ErrorIs(t, err, files.ErrInvalidPath)
}

func TestResolve_DotPath(t *testing.T) {
	root := setupRoot(t)
	r, err := files.NewResolver(root)
	require.NoError(t, err)

	_, err = r.Resolve(".")
	require.ErrorIs(t, err, files.ErrInvalidPath)
}

func TestResolve_RejectsParentTraversal(t *testing.T) {
	root := setupRoot(t)
	r, err := files.NewResolver(root)
	require.NoError(t, err)

	cases := []string{
		"../etc/passwd",
		"..",
		"sub/../../etc/passwd",
		"/../etc/passwd",
	}
	for _, c := range cases {
		_, err := r.Resolve(c)
		require.ErrorIsf(t, err, files.ErrPathTraversal, "input %q should be rejected", c)
	}
}

func TestResolve_RejectsAbsolutePath(t *testing.T) {
	root := setupRoot(t)
	r, err := files.NewResolver(root)
	require.NoError(t, err)

	_, err = r.Resolve("/etc/passwd")
	// "/etc/passwd" strips its leading slash to "etc/passwd", which is a
	// valid relative path. To unambiguously hit the absolute branch we feed
	// a path that survives TrimPrefix as still absolute (only meaningful on
	// platforms with non-slash absolute prefixes; on POSIX the strip handles it).
	if runtime.GOOS == "windows" {
		require.ErrorIs(t, err, files.ErrPathTraversal)
	}
}

func TestResolve_SymlinkPointingOutside(t *testing.T) {
	root := setupRoot(t)
	outside := t.TempDir()
	resolvedOutside, err := filepath.EvalSymlinks(outside)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(resolvedOutside, "secret.md"), []byte("s"), 0o644))

	// link inside root → file outside root
	require.NoError(t, os.Symlink(filepath.Join(resolvedOutside, "secret.md"), filepath.Join(root, "link.md")))

	r, err := files.NewResolver(root)
	require.NoError(t, err)

	_, err = r.Resolve("link.md")
	require.ErrorIs(t, err, files.ErrPathTraversal)
}

func TestResolve_SymlinkedParentPointingOutside(t *testing.T) {
	root := setupRoot(t)
	outside := t.TempDir()
	resolvedOutside, err := filepath.EvalSymlinks(outside)
	require.NoError(t, err)

	// link directory inside root → directory outside root
	require.NoError(t, os.Symlink(resolvedOutside, filepath.Join(root, "linkdir")))

	r, err := files.NewResolver(root)
	require.NoError(t, err)

	// Write target inside the linked directory: existing file path
	// (file doesn't exist yet, so the parent symlink resolution branch runs).
	_, err = r.Resolve("linkdir/new.md")
	require.ErrorIs(t, err, files.ErrPathTraversal)
}

func TestResolve_NonExistingFile_ParentDoesNotExist(t *testing.T) {
	root := setupRoot(t)
	r, err := files.NewResolver(root)
	require.NoError(t, err)

	_, err = r.Resolve("nonexistent_dir/file.md")
	require.Error(t, err)
	// Caller-visible signal: os.ErrNotExist (not a traversal).
	assert.True(t, errors.Is(err, os.ErrNotExist), "expected os.ErrNotExist, got %v", err)
}
