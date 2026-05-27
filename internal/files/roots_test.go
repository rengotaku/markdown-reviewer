package files_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"markdown-reviewer/internal/files"
)

func TestNewRoots_Success(t *testing.T) {
	a := setupRoot(t)
	b := t.TempDir()
	b, err := filepath.EvalSymlinks(b)
	require.NoError(t, err)

	roots, err := files.NewRoots([]files.RootSpec{
		{Name: "works", Path: a},
		{Name: "rooms", Path: b},
	})
	require.NoError(t, err)

	got, ok := roots.Get("works")
	require.True(t, ok)
	assert.Equal(t, a, got.Root())

	got, ok = roots.Get("rooms")
	require.True(t, ok)
	assert.Equal(t, b, got.Root())

	def, name := roots.Default()
	require.NotNil(t, def)
	assert.Equal(t, "works", name, "default is the first declared root")
	assert.Equal(t, a, def.Root())
}

func TestNewRoots_EmptySlice(t *testing.T) {
	_, err := files.NewRoots(nil)
	require.Error(t, err)
}

func TestNewRoots_DuplicateName(t *testing.T) {
	root := setupRoot(t)
	_, err := files.NewRoots([]files.RootSpec{
		{Name: "x", Path: root},
		{Name: "x", Path: root},
	})
	require.Error(t, err)
}

func TestNewRoots_NameWithSeparator(t *testing.T) {
	root := setupRoot(t)
	_, err := files.NewRoots([]files.RootSpec{
		{Name: "bad/name", Path: root},
	})
	require.Error(t, err)
}

func TestNewRoots_NameEmpty(t *testing.T) {
	root := setupRoot(t)
	_, err := files.NewRoots([]files.RootSpec{
		{Name: "", Path: root},
	})
	require.Error(t, err)
}

func TestNewRoots_PathMustExist(t *testing.T) {
	_, err := files.NewRoots([]files.RootSpec{
		{Name: "x", Path: filepath.Join(t.TempDir(), "does-not-exist")},
	})
	require.Error(t, err)
}

func TestRoots_GetUnknownReturnsFalse(t *testing.T) {
	root := setupRoot(t)
	roots, err := files.NewRoots([]files.RootSpec{{Name: "x", Path: root}})
	require.NoError(t, err)

	_, ok := roots.Get("nope")
	assert.False(t, ok)
}

func TestRoots_ListPreservesOrder(t *testing.T) {
	a := setupRoot(t)
	b := t.TempDir()
	b, err := filepath.EvalSymlinks(b)
	require.NoError(t, err)

	roots, err := files.NewRoots([]files.RootSpec{
		{Name: "second", Path: a},
		{Name: "first", Path: b},
	})
	require.NoError(t, err)

	list := roots.List()
	require.Len(t, list, 2)
	assert.Equal(t, "second", list[0].Name)
	assert.Equal(t, "first", list[1].Name)
}

func TestParseRootsJSON_Success(t *testing.T) {
	specs, err := files.ParseRootsJSON(`[{"name":"works","path":"/tmp/a"},{"name":"rooms","path":"/tmp/b"}]`)
	require.NoError(t, err)
	require.Len(t, specs, 2)
	assert.Equal(t, "works", specs[0].Name)
	assert.Equal(t, "/tmp/a", specs[0].Path)
	assert.Equal(t, "rooms", specs[1].Name)
	assert.Equal(t, "/tmp/b", specs[1].Path)
}

func TestParseRootsJSON_Malformed(t *testing.T) {
	_, err := files.ParseRootsJSON(`{not json`)
	require.Error(t, err)
}

func TestParseRootsJSON_EmptyArray(t *testing.T) {
	_, err := files.ParseRootsJSON(`[]`)
	require.Error(t, err)
}

// TestNewRoots_PathTraversalPerRoot exercises that the resolver attached to
// one root cannot reach files in another root via "..": the safety check
// lives in Resolver and is per-root by construction.
func TestNewRoots_PathTraversalPerRoot(t *testing.T) {
	a := setupRoot(t)
	b := t.TempDir()
	b, err := filepath.EvalSymlinks(b)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(b, "secret.md"), []byte("x"), 0o644))

	roots, err := files.NewRoots([]files.RootSpec{
		{Name: "a", Path: a},
		{Name: "b", Path: b},
	})
	require.NoError(t, err)

	resA, _ := roots.Get("a")
	_, err = resA.Resolve("../" + filepath.Base(b) + "/secret.md")
	require.Error(t, err, "root 'a' must not be able to reach root 'b'")
}
