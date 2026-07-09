package launchd_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"markdown-reviewer/internal/launchd"
)

func TestRootFlag_NameDefaultsToBasename(t *testing.T) {
	dir := t.TempDir()
	sub := filepath.Join(dir, "works")
	require.NoError(t, os.MkdirAll(sub, 0o755))

	var f launchd.RootFlag
	require.NoError(t, f.Set(sub))

	require.Len(t, f.Specs, 1)
	assert.Equal(t, "works", f.Specs[0].Name)
	assert.Equal(t, sub, f.Specs[0].Path)
}

func TestRootFlag_ExplicitName(t *testing.T) {
	dir := t.TempDir()
	sub := filepath.Join(dir, "rooms")
	require.NoError(t, os.MkdirAll(sub, 0o755))

	var f launchd.RootFlag
	require.NoError(t, f.Set("rooms="+sub))

	require.Len(t, f.Specs, 1)
	assert.Equal(t, "rooms", f.Specs[0].Name)
	assert.Equal(t, sub, f.Specs[0].Path)
}

// TestRootFlag_EqualsInPathTreatedAsPathOnly covers the parsing rule: when
// the part before the first '=' contains a path separator, the whole
// argument is the path (no name), even though it contains '='.
func TestRootFlag_EqualsInPathTreatedAsPathOnly(t *testing.T) {
	dir := t.TempDir()
	sub := filepath.Join(dir, "a=b")
	require.NoError(t, os.MkdirAll(sub, 0o755))

	var f launchd.RootFlag
	require.NoError(t, f.Set(sub))

	require.Len(t, f.Specs, 1)
	assert.Equal(t, "a=b", f.Specs[0].Name)
	assert.Equal(t, sub, f.Specs[0].Path)
}

func TestRootFlag_HomeExpansion(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	sub := filepath.Join(home, "notes")
	require.NoError(t, os.MkdirAll(sub, 0o755))

	var f launchd.RootFlag
	require.NoError(t, f.Set("~/notes"))
	require.Len(t, f.Specs, 1)
	assert.Equal(t, sub, f.Specs[0].Path)

	var fBare launchd.RootFlag
	require.NoError(t, fBare.Set("~"))
	require.Len(t, fBare.Specs, 1)
	assert.Equal(t, home, fBare.Specs[0].Path)
}

func TestRootFlag_DuplicateNameRejected(t *testing.T) {
	dir := t.TempDir()
	a := filepath.Join(dir, "a")
	b := filepath.Join(dir, "b")
	require.NoError(t, os.MkdirAll(a, 0o755))
	require.NoError(t, os.MkdirAll(b, 0o755))

	var f launchd.RootFlag
	require.NoError(t, f.Set("notes="+a))
	err := f.Set("notes=" + b)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "duplicate root name")
}

// TestRootFlag_WhitespaceNameRejected covers the name validation path: "a
// b" (space, no path separator) parses as an explicit name per the "=" split
// rule, and must be rejected.
func TestRootFlag_WhitespaceNameRejected(t *testing.T) {
	dir := t.TempDir()
	sub := filepath.Join(dir, "notes")
	require.NoError(t, os.MkdirAll(sub, 0o755))

	var f launchd.RootFlag
	err := f.Set("a b=" + sub)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "must not contain whitespace")
}

// TestRootFlag_NameWithPathSeparatorTreatedAsPathOnly documents that a
// candidate name containing '/' before the first '=' is never parsed as a
// name at all (per splitNamePath's rule) — the whole argument becomes the
// path. Here that literal path ("a/b=<dir>") does not exist, so Set must
// fail with the path error, not a name-validation error.
func TestRootFlag_NameWithPathSeparatorTreatedAsPathOnly(t *testing.T) {
	var f launchd.RootFlag
	err := f.Set("a/b=" + t.TempDir())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "does not exist")
	assert.NotContains(t, err.Error(), "path separators")
}

func TestRootFlag_NonexistentPathRejected(t *testing.T) {
	dir := t.TempDir()
	missing := filepath.Join(dir, "does-not-exist")

	var f launchd.RootFlag
	err := f.Set(missing)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "does not exist")
}

func TestRootFlag_NotADirectoryRejected(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "notes.txt")
	require.NoError(t, os.WriteFile(file, []byte("content"), 0o644))

	var f launchd.RootFlag
	err := f.Set(file)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "is not a directory")
}

func TestRootFlag_JSON(t *testing.T) {
	dir := t.TempDir()
	a := filepath.Join(dir, "a")
	b := filepath.Join(dir, "b")
	require.NoError(t, os.MkdirAll(a, 0o755))
	require.NoError(t, os.MkdirAll(b, 0o755))

	var f launchd.RootFlag
	require.NoError(t, f.Set("first="+a))
	require.NoError(t, f.Set("second="+b))

	got, err := f.JSON()
	require.NoError(t, err)

	want, err := json.Marshal([]map[string]string{
		{"name": "first", "path": a},
		{"name": "second", "path": b},
	})
	require.NoError(t, err)
	assert.JSONEq(t, string(want), got)
}

func TestRootFlag_JSONEmptyWhenUnset(t *testing.T) {
	var f launchd.RootFlag
	got, err := f.JSON()
	require.NoError(t, err)
	assert.Empty(t, got)
}

func TestRootFlag_String(t *testing.T) {
	dir := t.TempDir()
	sub := filepath.Join(dir, "notes")
	require.NoError(t, os.MkdirAll(sub, 0o755))

	var f launchd.RootFlag
	require.NoError(t, f.Set("notes="+sub))
	assert.Equal(t, "notes="+sub, f.String())
}
