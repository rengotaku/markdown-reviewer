package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"markdown-reviewer/internal/files"
)

// launchdPlist is the markdown-reviewer launchd agent, relative to $HOME. It
// holds the REVIEW_ROOTS the server runs with; the CLI reads it so it resolves
// the same roots without the server's launchd environment.
const launchdPlist = "Library/LaunchAgents/com.user.markdown-reviewer.plist"

// rootEntry pairs a root name with its symlink-resolved absolute directory.
type rootEntry struct {
	name string
	abs  string
}

// loadRoots resolves the configured roots the way the server does, but for a
// process (this CLI) that lacks the server's launchd env: REVIEW_ROOTS from the
// environment when set, otherwise extracted from the launchd plist via plutil.
func loadRoots() ([]rootEntry, error) {
	raw := strings.TrimSpace(os.Getenv("REVIEW_ROOTS"))
	if raw == "" {
		var err error
		if raw, err = rootsFromPlist(); err != nil {
			return nil, err
		}
	}
	specs, err := files.ParseRootsJSON(raw)
	if err != nil {
		return nil, err
	}
	out := make([]rootEntry, 0, len(specs))
	for _, s := range specs {
		abs := expandHome(s.Path)
		if resolved, err := filepath.EvalSymlinks(abs); err == nil {
			abs = resolved
		} else if a, err := filepath.Abs(abs); err == nil {
			abs = a
		}
		out = append(out, rootEntry{name: s.Name, abs: abs})
	}
	return out, nil
}

// rootsFromPlist extracts the REVIEW_ROOTS JSON string from the launchd plist.
func rootsFromPlist() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	p := filepath.Join(home, launchdPlist)
	out, err := exec.Command("plutil", "-extract", "EnvironmentVariables.REVIEW_ROOTS", "raw", "-o", "-", p).Output()
	if err != nil {
		return "", fmt.Errorf("REVIEW_ROOTS is unset and reading %s failed: %w (start the markdown-reviewer server, or export REVIEW_ROOTS)", p, err)
	}
	return strings.TrimSpace(string(out)), nil
}

// resolvePath maps a user-supplied file path (absolute or relative to cwd) to
// the (rootName, relPath, absFile) reviewstore keys on. relPath uses the same
// forward-slash, root-relative form the server derives from request URLs, so
// the CLI and the web UI address the same sidecar entry.
func resolvePath(arg string) (root, rel, abs string, err error) {
	abs, err = filepath.Abs(arg)
	if err != nil {
		return "", "", "", err
	}
	if resolved, e := filepath.EvalSymlinks(abs); e == nil {
		abs = resolved
	}
	roots, err := loadRoots()
	if err != nil {
		return "", "", "", err
	}
	for _, r := range roots {
		if rel, ok := relUnder(r.abs, abs); ok {
			return r.name, rel, abs, nil
		}
	}
	names := make([]string, len(roots))
	for i, r := range roots {
		names[i] = r.name
	}
	return "", "", "", fmt.Errorf("%q is not under any configured root (%s)", arg, strings.Join(names, ", "))
}

// relUnder returns file's path relative to root (forward-slash) when file sits
// inside root, mirroring the resolver's containment check.
func relUnder(root, file string) (string, bool) {
	rel, err := filepath.Rel(root, file)
	if err != nil {
		return "", false
	}
	if rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", false
	}
	return filepath.ToSlash(rel), true
}

// expandHome expands a leading ~ so REVIEW_ROOTS entries written with ~ resolve.
func expandHome(p string) string {
	if p != "~" && !strings.HasPrefix(p, "~/") {
		return p
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return p
	}
	if p == "~" {
		return home
	}
	return filepath.Join(home, p[2:])
}
