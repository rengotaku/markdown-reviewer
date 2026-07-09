package launchd

import (
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// errNotLoaded is returned by FakeRunner's Bootout/Print when the target
// isn't currently loaded, mirroring launchctl's own exit-non-zero behavior
// for that case (which Install/Uninstall/Status treat as tolerable).
var errNotLoaded = errors.New("not loaded")

// unloadPollInterval / unloadPollAttempts bound how long Install waits for a
// prior bootout to fully unload an agent with KeepAlive=true before
// bootstrapping the replacement, matching scripts/install-launchd.sh's
// original 0.5s x 10 polling loop.
var unloadPollInterval = 500 * time.Millisecond

const unloadPollAttempts = 10

// domain returns the launchd GUI domain for the current user, e.g.
// "gui/501".
func domain() string {
	return "gui/" + strconv.Itoa(os.Getuid())
}

// target returns the launchd service target for label within the current
// user's GUI domain, e.g. "gui/501/com.user.markdown-reviewer".
func target(label string) string {
	return domain() + "/" + label
}

// requireDarwin returns an error on any platform other than darwin, since
// launchd (and thus every operation in this package) is macOS-only.
func requireDarwin() error {
	return requireGOOS(runtime.GOOS)
}

// requireGOOS is requireDarwin's logic with GOOS injected, so the
// non-darwin error path is exercisable from tests regardless of the
// platform they actually run on.
func requireGOOS(goos string) error {
	if goos != "darwin" {
		return fmt.Errorf("service subcommand is only supported on macOS (darwin), got %s", goos)
	}
	return nil
}

// Install renders the launchd plist for opts, writes it to
// ~/Library/LaunchAgents/<label>.plist, and (re)loads it via runner. argv0
// is os.Args[0] from the invoking process, used to resolve the binary path
// baked into the plist (see ProgramPath). out receives progress messages.
func Install(opts Options, argv0 string, runner Runner, out io.Writer) error {
	if err := requireDarwin(); err != nil {
		return err
	}
	resolved, err := ResolveOptions(opts, true)
	if err != nil {
		return err
	}

	program, err := ProgramPath(argv0)
	if err != nil {
		return err
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("resolve home directory: %w", err)
	}

	logDir := logDirPath(home)
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		return fmt.Errorf("create log directory %s: %w", logDir, err)
	}

	plistFile := plistPath(home, resolved.Label)
	if err := os.MkdirAll(filepath.Dir(plistFile), 0o755); err != nil {
		return fmt.Errorf("create LaunchAgents directory: %w", err)
	}
	content := renderPlist(resolved, program, home, logDir)
	if err := os.WriteFile(plistFile, []byte(content), 0o600); err != nil {
		return fmt.Errorf("write plist %s: %w", plistFile, err)
	}

	tgt := target(resolved.Label)
	if _, err := runner.Print(tgt); err == nil {
		// Already loaded: unload first so the new plist takes effect, and
		// wait for KeepAlive=true's supervisor to fully stop before we
		// bootstrap the replacement (bootstrapping over a still-shutting-
		// down agent can fail or leave two instances racing for the port).
		if err := runner.Bootout(tgt); err != nil {
			return fmt.Errorf("bootout existing agent %s: %w", tgt, err)
		}
		if err := waitUnloaded(runner, tgt); err != nil {
			return err
		}
	}

	// A foreign process (e.g. a foreground `markdown-review-server` left
	// running) still holding the port would make the KeepAlive=true agent
	// crashloop, so refuse to load rather than bootstrap into that state.
	// Checked after the bootout above because a previous install of the same
	// label legitimately holds the port until it is unloaded.
	if err := checkPortFree(resolved.Port); err != nil {
		return fmt.Errorf("%w (the plist was written to %s but the agent was not loaded; free the port or pick another with --port, then rerun install)", err, plistFile)
	}

	if err := runner.Bootstrap(domain(), plistFile); err != nil {
		return fmt.Errorf("bootstrap %s: %w", plistFile, err)
	}
	// bootstrap with RunAtLoad=true can still skip the actual launch in some
	// cases; kickstart forces it, matching install-launchd.sh's behavior.
	if err := runner.Kickstart(tgt); err != nil {
		return fmt.Errorf("kickstart %s: %w", tgt, err)
	}

	_, _ = fmt.Fprintf(out, "installed: %s\n", resolved.Label)
	_, _ = fmt.Fprintf(out, "plist: %s\n", plistFile)
	_, _ = fmt.Fprintf(out, "port: %s\n", resolved.Port)
	if resolved.ReviewRoots != "" {
		_, _ = fmt.Fprintf(out, "REVIEW_ROOTS: %s\n", resolved.ReviewRoots)
	} else {
		_, _ = fmt.Fprintf(out, "REVIEW_ROOT: %s\n", resolved.ReviewRoot)
	}
	_, _ = fmt.Fprintf(out, "logs: %s/\n", logDir)
	return nil
}

// checkPortFree refuses to proceed when something is already listening on
// port. It's a package var so flow tests can stub it and stay independent of
// the host's real TCP state.
var checkPortFree = func(port string) error {
	ln, err := net.Listen("tcp", ":"+port)
	if err != nil {
		return fmt.Errorf("port %s is already in use", port)
	}
	_ = ln.Close()
	return nil
}

// waitUnloaded polls runner.Print(tgt) until it reports "not loaded" (i.e.
// an error), or gives up after unloadPollAttempts. Any Print error is
// treated as "unloaded" — launchctl print can also fail for other reasons
// (domain issues, permissions), but for a per-user GUI agent those are rare
// enough that distinguishing them isn't worth parsing launchctl's output.
func waitUnloaded(runner Runner, tgt string) error {
	for i := 0; i < unloadPollAttempts; i++ {
		if _, err := runner.Print(tgt); err != nil {
			return nil
		}
		time.Sleep(unloadPollInterval)
	}
	return fmt.Errorf("agent %s did not unload after %d attempts", tgt, unloadPollAttempts)
}

// Uninstall unloads the agent identified by label (tolerating "not
// loaded") and removes its plist (tolerating "already absent").
func Uninstall(label string, runner Runner, out io.Writer) error {
	if err := requireDarwin(); err != nil {
		return err
	}
	resolved, err := ResolveOptions(Options{Label: label}, false)
	if err != nil {
		return err
	}

	tgt := target(resolved.Label)
	if bootoutErr := runner.Bootout(tgt); bootoutErr != nil {
		_, _ = fmt.Fprintf(out, "note: %s was not loaded (%v)\n", resolved.Label, bootoutErr)
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("resolve home directory: %w", err)
	}
	plistFile := plistPath(home, resolved.Label)
	if removeErr := os.Remove(plistFile); removeErr != nil {
		if !os.IsNotExist(removeErr) {
			return fmt.Errorf("remove plist %s: %w", plistFile, removeErr)
		}
		_, _ = fmt.Fprintf(out, "note: %s did not exist\n", plistFile)
	}

	_, _ = fmt.Fprintf(out, "uninstalled: %s\n", resolved.Label)
	return nil
}

// Status reports whether label's plist exists, whether launchd currently
// considers it running, and (when the plist exists) the PORT / REVIEW_ROOTS
// / REVIEW_ROOT it was installed with.
func Status(label string, runner Runner, out io.Writer) error {
	if err := requireDarwin(); err != nil {
		return err
	}
	resolved, err := ResolveOptions(Options{Label: label}, false)
	if err != nil {
		return err
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("resolve home directory: %w", err)
	}
	plistFile := plistPath(home, resolved.Label)

	_, _ = fmt.Fprintf(out, "label: %s\n", resolved.Label)
	_, _ = fmt.Fprintf(out, "plist: %s\n", plistFile)

	content, readErr := os.ReadFile(plistFile)
	if readErr != nil {
		if os.IsNotExist(readErr) {
			_, _ = fmt.Fprintln(out, "plist: not installed")
		} else {
			_, _ = fmt.Fprintf(out, "plist: error reading (%v)\n", readErr)
		}
	} else {
		_, _ = fmt.Fprintln(out, "plist: installed")
		if port := extractPlistValue(string(content), "PORT"); port != "" {
			_, _ = fmt.Fprintf(out, "port: %s\n", port)
		}
		if roots := extractPlistValue(string(content), "REVIEW_ROOTS"); roots != "" {
			_, _ = fmt.Fprintf(out, "REVIEW_ROOTS: %s\n", roots)
		}
		if root := extractPlistValue(string(content), "REVIEW_ROOT"); root != "" {
			_, _ = fmt.Fprintf(out, "REVIEW_ROOT: %s\n", root)
		}
	}

	tgt := target(resolved.Label)
	if _, printErr := runner.Print(tgt); printErr != nil {
		_, _ = fmt.Fprintln(out, "state: stopped")
	} else {
		_, _ = fmt.Fprintln(out, "state: running")
	}
	return nil
}

// labelFromPlistFile reads path and extracts its Label value, used by
// FakeRunner.Bootstrap to derive the target key the way real launchctl
// would (from the plist's own Label key, not from a caller-supplied string).
func labelFromPlistFile(path string) (string, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read plist %s: %w", path, err)
	}
	label := extractPlistValue(string(content), "Label")
	if label == "" {
		return "", fmt.Errorf("plist %s has no Label key", path)
	}
	return label, nil
}

// extractPlistValue is a minimal same-line scanner for
// "<key>NAME</key>\n<string>VALUE</string>" pairs, used to surface the
// installed PORT/REVIEW_ROOTS/REVIEW_ROOT in `service status` without
// pulling in a full plist parser. It unescapes the XML entities renderPlist
// writes ('&amp;', '&lt;', '&gt;'). Returns "" if the key isn't found.
func extractPlistValue(plist, key string) string {
	marker := "<key>" + key + "</key>"
	idx := strings.Index(plist, marker)
	if idx == -1 {
		return ""
	}
	rest := plist[idx+len(marker):]
	open := strings.Index(rest, "<string>")
	if open == -1 {
		return ""
	}
	rest = rest[open+len("<string>"):]
	closeIdx := strings.Index(rest, "</string>")
	if closeIdx == -1 {
		return ""
	}
	value := rest[:closeIdx]
	value = strings.ReplaceAll(value, "&lt;", "<")
	value = strings.ReplaceAll(value, "&gt;", ">")
	value = strings.ReplaceAll(value, "&amp;", "&")
	return value
}
