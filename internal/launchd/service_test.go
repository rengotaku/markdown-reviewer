package launchd_test

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"markdown-reviewer/internal/launchd"
)

// isolateHome points $HOME at a fresh temp dir for the duration of the test,
// so Install/Uninstall/Status (which resolve paths via os.UserHomeDir())
// never touch the real ~/Library/LaunchAgents. It also stubs Install's
// port-in-use probe so tests don't depend on the host's real TCP state
// (the default port may legitimately be busy on a developer machine).
func isolateHome(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Cleanup(launchd.SetCheckPortFreeForTest(func(string) error { return nil }))
	// The flows only talk to the FakeRunner here, so let them run on the
	// linux CI runner too instead of failing the darwin-only guard.
	t.Cleanup(launchd.SetGOOSForTest("darwin"))
	return home
}

func plistFilePath(home, label string) string {
	return filepath.Join(home, "Library", "LaunchAgents", label+".plist")
}

func TestInstall_WritesPlistAndLoadsAgent(t *testing.T) {
	home := isolateHome(t)
	runner := launchd.NewFakeRunner()
	var out bytes.Buffer

	opts := launchd.Options{
		Label:      "com.test.markdown-reviewer",
		Port:       "12345",
		ReviewRoot: "/tmp/notes",
	}
	err := launchd.Install(opts, "/opt/homebrew/bin/markdown-review-server", runner, &out)
	require.NoError(t, err)

	plistFile := plistFilePath(home, opts.Label)
	content, readErr := os.ReadFile(plistFile)
	require.NoError(t, readErr)

	info, statErr := os.Stat(plistFile)
	require.NoError(t, statErr)
	assert.Equal(t, os.FileMode(0o600), info.Mode().Perm())

	assert.Contains(t, string(content), "<string>com.test.markdown-reviewer</string>")
	assert.Contains(t, string(content), "<string>/opt/homebrew/bin/markdown-review-server</string>")
	assert.Contains(t, string(content), "<string>12345</string>")
	assert.Contains(t, string(content), "<string>/tmp/notes</string>")
	assert.Contains(t, string(content), "DATABASE_DSN")
	assert.Contains(t, string(content), ":memory:")

	logDir := filepath.Join(home, "Library", "Logs", "markdown-reviewer")
	assert.DirExists(t, logDir)
	assert.Contains(t, string(content), filepath.Join(logDir, "markdown-reviewer.out.log"))
	assert.Contains(t, string(content), filepath.Join(logDir, "markdown-reviewer.err.log"))

	assert.Contains(t, runner.Calls, "bootstrap:gui/"+uidString()+":"+plistFile)
	assert.Contains(t, runner.Calls, "kickstart:gui/"+uidString()+"/"+opts.Label)
	assert.True(t, runner.Loaded["gui/"+uidString()+"/"+opts.Label])

	assert.Contains(t, out.String(), "installed: "+opts.Label)
	assert.Contains(t, out.String(), "port: 12345")
	assert.Contains(t, out.String(), "REVIEW_ROOT: /tmp/notes")
}

func TestInstall_EscapesReviewRootsJSON(t *testing.T) {
	isolateHome(t)
	runner := launchd.NewFakeRunner()

	opts := launchd.Options{
		Label:       "com.test.markdown-reviewer",
		ReviewRoots: `[{"name":"a&b","path":"/tmp/<root>"}]`,
	}
	err := launchd.Install(opts, "/opt/homebrew/bin/markdown-review-server", runner, &bytes.Buffer{})
	require.NoError(t, err)

	home, _ := os.UserHomeDir()
	content, err := os.ReadFile(plistFilePath(home, opts.Label))
	require.NoError(t, err)

	// Raw '&'/'<'/'>' must never appear unescaped inside a <string> value,
	// or the plist becomes invalid XML.
	assert.NotContains(t, string(content), `"a&b"`)
	assert.NotContains(t, string(content), "/tmp/<root>")
	assert.Contains(t, string(content), "a&amp;b")
	assert.Contains(t, string(content), "&lt;root&gt;")
}

func TestInstall_MissingReviewRootsErrors(t *testing.T) {
	isolateHome(t)
	t.Setenv("REVIEW_ROOTS", "")
	t.Setenv("REVIEW_ROOT", "")
	runner := launchd.NewFakeRunner()

	err := launchd.Install(launchd.Options{}, "markdown-review-server", runner, &bytes.Buffer{})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "REVIEW_ROOTS or REVIEW_ROOT")
	assert.Empty(t, runner.Calls, "launchctl must not be invoked when validation fails")
}

func TestInstall_PortInUseRefusesToLoad(t *testing.T) {
	home := isolateHome(t)
	t.Cleanup(launchd.SetCheckPortFreeForTest(func(port string) error {
		return fmt.Errorf("port %s is already in use", port)
	}))
	runner := launchd.NewFakeRunner()

	opts := launchd.Options{Label: "com.test.markdown-reviewer", Port: "12345", ReviewRoot: "/tmp/notes"}
	err := launchd.Install(opts, "markdown-review-server", runner, &bytes.Buffer{})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "port 12345 is already in use")
	assert.Contains(t, err.Error(), "--port")

	// The plist is written (the error message points at it) but the agent
	// must not be bootstrapped into a KeepAlive crashloop.
	assert.FileExists(t, plistFilePath(home, opts.Label))
	for _, call := range runner.Calls {
		assert.NotContains(t, call, "bootstrap:")
		assert.NotContains(t, call, "kickstart:")
	}
}

func TestInstall_ReloadsAlreadyLoadedAgent(t *testing.T) {
	home := isolateHome(t)
	runner := launchd.NewFakeRunner()

	opts := launchd.Options{Label: "com.test.markdown-reviewer", ReviewRoot: "/tmp/notes"}
	require.NoError(t, launchd.Install(opts, "markdown-review-server", runner, &bytes.Buffer{}))

	uid := uidString()
	tgt := "gui/" + uid + "/" + opts.Label
	require.True(t, runner.Loaded[tgt])

	// Installing again over an already-loaded agent must bootout first
	// (not just bootstrap again), matching the reload semantics of
	// scripts/install-launchd.sh.
	var out bytes.Buffer
	require.NoError(t, launchd.Install(opts, "markdown-review-server", runner, &out))

	assert.Contains(t, runner.Calls, "bootout:"+tgt)
	plistFile := plistFilePath(home, opts.Label)
	assert.Contains(t, runner.Calls, "bootstrap:gui/"+uid+":"+plistFile)
	assert.True(t, runner.Loaded[tgt])
}

func TestUninstall_RemovesPlistAndUnloadsAgent(t *testing.T) {
	home := isolateHome(t)
	runner := launchd.NewFakeRunner()

	opts := launchd.Options{Label: "com.test.markdown-reviewer", ReviewRoot: "/tmp/notes"}
	require.NoError(t, launchd.Install(opts, "markdown-review-server", runner, &bytes.Buffer{}))

	plistFile := plistFilePath(home, opts.Label)
	require.FileExists(t, plistFile)

	var out bytes.Buffer
	err := launchd.Uninstall(opts.Label, runner, &out)
	require.NoError(t, err)

	assert.NoFileExists(t, plistFile)
	assert.False(t, runner.Loaded["gui/"+uidString()+"/"+opts.Label])
	assert.Contains(t, out.String(), "uninstalled: "+opts.Label)
}

func TestUninstall_TolerantOfNotLoadedAndMissingPlist(t *testing.T) {
	isolateHome(t)
	runner := launchd.NewFakeRunner()

	var out bytes.Buffer
	err := launchd.Uninstall("com.test.never-installed", runner, &out)
	require.NoError(t, err)
	assert.Contains(t, out.String(), "was not loaded")
	assert.Contains(t, out.String(), "did not exist")
	assert.Contains(t, out.String(), "uninstalled: com.test.never-installed")
}

func TestUninstall_DefaultLabelWhenEmpty(t *testing.T) {
	isolateHome(t)
	runner := launchd.NewFakeRunner()

	err := launchd.Uninstall("", runner, &bytes.Buffer{})
	require.NoError(t, err)
	assert.Contains(t, runner.Calls, "bootout:gui/"+uidString()+"/"+launchd.DefaultLabel)
}

func TestStatus_NotInstalled(t *testing.T) {
	isolateHome(t)
	runner := launchd.NewFakeRunner()

	var out bytes.Buffer
	err := launchd.Status("com.test.markdown-reviewer", runner, &out)
	require.NoError(t, err)
	assert.Contains(t, out.String(), "plist: not installed")
	assert.Contains(t, out.String(), "state: stopped")
}

func TestStatus_InstalledAndRunning(t *testing.T) {
	isolateHome(t)
	runner := launchd.NewFakeRunner()

	opts := launchd.Options{Label: "com.test.markdown-reviewer", Port: "17000", ReviewRoot: "/tmp/notes"}
	require.NoError(t, launchd.Install(opts, "markdown-review-server", runner, &bytes.Buffer{}))

	var out bytes.Buffer
	err := launchd.Status(opts.Label, runner, &out)
	require.NoError(t, err)
	assert.Contains(t, out.String(), "plist: installed")
	assert.Contains(t, out.String(), "state: running")
	assert.Contains(t, out.String(), "port: 17000")
	assert.Contains(t, out.String(), "REVIEW_ROOT: /tmp/notes")
}

func TestStatus_InstalledButStopped(t *testing.T) {
	isolateHome(t)
	runner := launchd.NewFakeRunner()

	opts := launchd.Options{Label: "com.test.markdown-reviewer", ReviewRoot: "/tmp/notes"}
	require.NoError(t, launchd.Install(opts, "markdown-review-server", runner, &bytes.Buffer{}))
	// Simulate the agent having stopped/crashed out from under launchd's
	// bootstrap record without an explicit bootout.
	delete(runner.Loaded, "gui/"+uidString()+"/"+opts.Label)

	var out bytes.Buffer
	err := launchd.Status(opts.Label, runner, &out)
	require.NoError(t, err)
	assert.Contains(t, out.String(), "plist: installed")
	assert.Contains(t, out.String(), "state: stopped")
}

func uidString() string {
	return strconv.Itoa(os.Getuid())
}
