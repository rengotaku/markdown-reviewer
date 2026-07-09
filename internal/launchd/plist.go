// Package launchd installs, uninstalls, and reports the status of the
// markdown-review-server launchd agent on macOS.
//
// Logic lives here (plist rendering, option validation, path resolution, and
// the install/uninstall/status flows) so cmd/server/main.go stays a thin
// os.Args dispatcher. launchctl itself is invoked through the Runner
// interface (see runner.go) so the flows are testable with a fake.
package launchd

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// DefaultLabel is the launchd agent label used when --label is omitted. It
// is load-bearing for backward compatibility: cmd/mr/roots.go hard-codes
// this same label (via the plist path it reads with plutil), so changing it
// would break the CLI's REVIEW_ROOTS auto-resolution for existing installs.
const DefaultLabel = "com.user.markdown-reviewer"

// DefaultPort is the port markdown-review-server listens on when --port is
// omitted, matching the previous scripts/install-launchd.sh default.
const DefaultPort = "15174"

// plistTemplate renders the launchd agent property list. Placeholders are
// substituted by renderPlist below; values are XML-escaped there before
// substitution so REVIEW_ROOTS (a JSON string containing '&'/'<'/'>' where
// paths or names use those characters) can't break the XML.
const plistTemplate = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>__LABEL__</string>

    <key>ProgramArguments</key>
    <array>
        <string>__PROGRAM__</string>
    </array>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>HOME</key>
        <string>__HOME__</string>
        <key>PORT</key>
        <string>__PORT__</string>
        <key>REVIEW_ROOTS</key>
        <string>__REVIEW_ROOTS__</string>
        <key>REVIEW_ROOT</key>
        <string>__REVIEW_ROOT__</string>
        <key>DATABASE_DSN</key>
        <string>:memory:</string>
    </dict>

    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>__STDOUT__</string>
    <key>StandardErrorPath</key>
    <string>__STDERR__</string>
</dict>
</plist>
`

// xmlEscape escapes the three characters that are unsafe inside an XML
// string element: '&', '<', '>'. Order matters — '&' must be escaped first
// so the escape sequences for '<' and '>' aren't themselves re-escaped.
func xmlEscape(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	return s
}

// renderPlist substitutes opts and paths into plistTemplate, XML-escaping
// every substituted value. logDir is the directory StandardOutPath/
// StandardErrorPath live in (not escaped here since it's derived from
// os.UserHomeDir(), not user input, but escaped anyway for defense in depth).
//
// strings.NewReplacer scans the template exactly once and never rescans
// already-substituted text, so a value that happens to contain another
// placeholder literal (e.g. "__PORT__" inside the REVIEW_ROOTS JSON) stays
// literal instead of being re-substituted. A sequential ReplaceAll chain
// would corrupt the plist there, non-deterministically with map iteration.
func renderPlist(opts Options, program, home, logDir string) string {
	r := strings.NewReplacer(
		"__LABEL__", xmlEscape(opts.Label),
		"__PROGRAM__", xmlEscape(program),
		"__HOME__", xmlEscape(home),
		"__PORT__", xmlEscape(opts.Port),
		"__REVIEW_ROOTS__", xmlEscape(opts.ReviewRoots),
		"__REVIEW_ROOT__", xmlEscape(opts.ReviewRoot),
		"__STDOUT__", xmlEscape(filepath.Join(logDir, "markdown-reviewer.out.log")),
		"__STDERR__", xmlEscape(filepath.Join(logDir, "markdown-reviewer.err.log")),
	)
	return r.Replace(plistTemplate)
}

// plistPath returns the path the agent's plist is installed to for label,
// under the given home directory: ~/Library/LaunchAgents/<label>.plist.
func plistPath(home, label string) string {
	return filepath.Join(home, "Library", "LaunchAgents", label+".plist")
}

// logDirPath returns the directory markdown-review-server's stdout/stderr
// logs are written to under the given home directory.
func logDirPath(home string) string {
	return filepath.Join(home, "Library", "Logs", "markdown-reviewer")
}

// ProgramPath resolves the absolute path to the running binary, preferring
// argv[0] so a Homebrew Cask symlink (e.g. /opt/homebrew/bin/markdown-review-server
// -> Caskroom/.../markdown-review-server) is preserved in the generated
// plist rather than resolved to the versioned Caskroom target. Resolving to
// the real path would pin the plist to a specific Cask version and break on
// the next `brew upgrade`, since the Caskroom directory is removed/replaced.
//
// Resolution order:
//  1. argv[0] as-is, if it already contains a path separator (e.g. "./bin/x"
//     or an absolute path) — os.Args[0] is used verbatim in that case after
//     making it absolute, without following symlinks.
//  2. exec.LookPath(argv[0]), when argv[0] has no path separator (a bare
//     command name resolved via PATH, e.g. invoked as "markdown-review-server").
//  3. os.Executable(), as a last-resort fallback if both above fail.
func ProgramPath(argv0 string) (string, error) {
	if strings.ContainsRune(argv0, os.PathSeparator) {
		abs, err := filepath.Abs(argv0)
		if err == nil {
			return abs, nil
		}
	} else if resolved, err := exec.LookPath(argv0); err == nil {
		return resolved, nil
	}
	exe, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("resolve program path: %w", err)
	}
	return exe, nil
}
