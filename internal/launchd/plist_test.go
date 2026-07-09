package launchd_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"markdown-reviewer/internal/launchd"
)

func TestProgramPath_Argv0WithSeparator(t *testing.T) {
	got, err := launchd.ProgramPath("./bin/markdown-review-server")
	require.NoError(t, err)
	assert.True(t, filepath.IsAbs(got))
	assert.True(t, strings.HasSuffix(got, "bin/markdown-review-server"))
}

func TestProgramPath_Argv0AbsoluteWithSeparator(t *testing.T) {
	// A symlink-style absolute path (as brew would invoke it) must be kept
	// as-is, not resolved to a real path, so the plist survives Cask
	// upgrades that swap out the Caskroom target underneath the symlink.
	dir := t.TempDir()
	target := filepath.Join(dir, "real-binary")
	require.NoError(t, os.WriteFile(target, []byte("x"), 0o755))
	link := filepath.Join(dir, "markdown-review-server")
	require.NoError(t, os.Symlink(target, link))

	got, err := launchd.ProgramPath(link)
	require.NoError(t, err)
	assert.Equal(t, link, got)
}

func TestProgramPath_Argv0BareNameLooksUpPath(t *testing.T) {
	dir := t.TempDir()
	bin := filepath.Join(dir, "my-test-binary")
	require.NoError(t, os.WriteFile(bin, []byte("#!/bin/sh\n"), 0o755))
	t.Setenv("PATH", dir)

	got, err := launchd.ProgramPath("my-test-binary")
	require.NoError(t, err)
	assert.Equal(t, bin, got)
}

func TestProgramPath_FallsBackToExecutable(t *testing.T) {
	// A bare name that isn't on PATH exercises the os.Executable() fallback;
	// it should still succeed with some absolute path (the test binary
	// itself), rather than erroring out.
	t.Setenv("PATH", t.TempDir())

	got, err := launchd.ProgramPath("this-name-does-not-exist-anywhere")
	require.NoError(t, err)
	assert.True(t, filepath.IsAbs(got))
}
