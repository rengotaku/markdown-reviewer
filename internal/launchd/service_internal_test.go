package launchd

import (
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestRenderPlist_ValueContainingPlaceholderLiteral is the regression test
// for the sequential-ReplaceAll bug: a substituted value that happens to
// contain another placeholder's literal (here "__PORT__" inside the
// REVIEW_ROOTS JSON) must stay literal instead of being re-substituted by a
// later replacement pass.
func TestRenderPlist_ValueContainingPlaceholderLiteral(t *testing.T) {
	opts := Options{
		Label:       "com.test.markdown-reviewer",
		Port:        "9999",
		ReviewRoots: `[{"name":"__PORT__","path":"/tmp/__LABEL__"}]`,
	}
	out := renderPlist(opts, "/bin/x", "/home/u", "/home/u/logs")

	assert.Contains(t, out, `[{"name":"__PORT__","path":"/tmp/__LABEL__"}]`)
	assert.NotContains(t, out, `"name":"9999"`)
	assert.NotContains(t, out, "/tmp/com.test.markdown-reviewer")
}

// TestRequireGOOS exercises requireDarwin's platform check with an injected
// GOOS, since the real runtime.GOOS is fixed per test run and this package
// only ever runs its CI on darwin.
func TestRequireGOOS(t *testing.T) {
	require.NoError(t, requireGOOS("darwin"))

	err := requireGOOS("linux")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "macOS (darwin)")
	assert.Contains(t, err.Error(), "linux")
}

func TestWaitUnloaded_TimesOut(t *testing.T) {
	orig := unloadPollInterval
	unloadPollInterval = time.Millisecond
	defer func() { unloadPollInterval = orig }()

	runner := NewFakeRunner()
	// Loaded stays true forever: Print never errors, so waitUnloaded should
	// exhaust its retry budget and return an error rather than hang.
	runner.Loaded["gui/999/com.test.stuck"] = true

	err := waitUnloaded(runner, "gui/999/com.test.stuck")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "did not unload")
}

func TestExtractPlistValue_KeyNotFound(t *testing.T) {
	assert.Equal(t, "", extractPlistValue("<dict></dict>", "PORT"))
	assert.Equal(t, "", extractPlistValue("<key>PORT</key>", "PORT"))
	assert.Equal(t, "", extractPlistValue("<key>PORT</key><string>no-close", "PORT"))
}

func TestLabelFromPlistFile_MissingFile(t *testing.T) {
	_, err := labelFromPlistFile("/nonexistent/path/to.plist")
	require.Error(t, err)
}

func TestLabelFromPlistFile_NoLabelKey(t *testing.T) {
	dir := t.TempDir()
	path := dir + "/broken.plist"
	require.NoError(t, os.WriteFile(path, []byte("<plist><dict></dict></plist>"), 0o600))

	_, err := labelFromPlistFile(path)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no Label key")
}
