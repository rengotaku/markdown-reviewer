package files_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"markdown-reviewer/internal/files"
)

func TestNewRoots_RejectsAdhocName(t *testing.T) {
	_, err := files.NewRoots([]files.RootSpec{{Name: files.AdhocRootName, Path: t.TempDir()}})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "reserved")
}

func TestRoots_SetAdhoc(t *testing.T) {
	configured, err := filepath.EvalSymlinks(t.TempDir())
	require.NoError(t, err)
	roots, err := files.NewRoots([]files.RootSpec{{Name: "works", Path: configured}})
	require.NoError(t, err)

	first, err := filepath.EvalSymlinks(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(first, "a.md"), []byte("a"), 0o644))
	require.NoError(t, os.WriteFile(filepath.Join(first, "b.md"), []byte("b"), 0o644))

	prev, err := roots.SetAdhoc(first, "a.md")
	require.NoError(t, err)
	assert.Empty(t, prev, "nothing occupied the slot yet")

	resolver, ok := roots.Get(files.AdhocRootName)
	require.True(t, ok)
	got, err := resolver.Resolve("a.md")
	require.NoError(t, err)
	assert.Equal(t, filepath.Join(first, "a.md"), got)

	_, err = resolver.Resolve("b.md")
	assert.ErrorIs(t, err, files.ErrPathTraversal, "the slot is narrowed to one file")

	// The default root is unaffected and the slot never becomes it.
	def, defName := roots.Default()
	assert.Equal(t, "works", defName)
	assert.Equal(t, configured, def.Root())

	// Replacing reports the directory the slot pointed at before.
	second, err := filepath.EvalSymlinks(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(second, "c.md"), []byte("c"), 0o644))
	prev, err = roots.SetAdhoc(second, "c.md")
	require.NoError(t, err)
	assert.Equal(t, first, prev)

	list := roots.List()
	require.Len(t, list, 2, "replacing must not append a second slot")
	assert.Equal(t, files.AdhocRootName, list[1].Name)
	assert.True(t, list[1].Ephemeral)
	assert.False(t, list[0].Ephemeral)
}

func TestRoots_SetAdhoc_MissingDir(t *testing.T) {
	roots, err := files.NewRoots([]files.RootSpec{{Name: "works", Path: t.TempDir()}})
	require.NoError(t, err)
	_, err = roots.SetAdhoc(filepath.Join(t.TempDir(), "nope"), "a.md")
	assert.Error(t, err)
}

func TestRoots_Locate(t *testing.T) {
	configured, err := filepath.EvalSymlinks(t.TempDir())
	require.NoError(t, err)
	roots, err := files.NewRoots([]files.RootSpec{{Name: "works", Path: configured}})
	require.NoError(t, err)

	name, rel, ok := roots.Locate(filepath.Join(configured, "sub", "x.md"))
	require.True(t, ok)
	assert.Equal(t, "works", name)
	assert.Equal(t, "sub/x.md", rel)

	outside, err := filepath.EvalSymlinks(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(outside, "o.md"), []byte("o"), 0o644))
	_, _, ok = roots.Locate(filepath.Join(outside, "o.md"))
	assert.False(t, ok)

	// Even once the slot holds it, Locate keeps ignoring the slot.
	_, err = roots.SetAdhoc(outside, "o.md")
	require.NoError(t, err)
	_, _, ok = roots.Locate(filepath.Join(outside, "o.md"))
	assert.False(t, ok, "Locate must skip the ephemeral slot")
}
