package launchd

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"markdown-reviewer/internal/files"
)

// RootFlag implements flag.Value for a repeatable --root flag, collecting
// "[name=]path" entries into an ordered list of files.RootSpec. Zero value is
// ready to use (append starts from a nil slice).
type RootFlag struct {
	Specs []files.RootSpec
}

// String implements flag.Value. It's only used by the flag package to print
// the current value (e.g. in -h output), so a compact join is enough.
func (f *RootFlag) String() string {
	parts := make([]string, len(f.Specs))
	for i, spec := range f.Specs {
		parts[i] = spec.Name + "=" + spec.Path
	}
	return strings.Join(parts, ",")
}

// Set implements flag.Value. It's called once per --root occurrence with the
// raw "[name=]path" argument, and appends the parsed entry to f.Specs.
//
// Parsing rule: everything before the first '=' is treated as the name only
// if it contains no path separator; otherwise (or when there's no '=' at
// all) the whole argument is the path and the name defaults to
// filepath.Base(path). This lets "rooms=~/ot/rooms" and "~/ot/works" (no '=')
// both work, while "C:\path=x" (path separator before '=') doesn't misparse
// the drive/path as a name.
func (f *RootFlag) Set(raw string) error {
	name, path := splitNamePath(raw)

	expanded, err := expandHome(path)
	if err != nil {
		return fmt.Errorf("--root %q: %w", raw, err)
	}
	abs, err := filepath.Abs(expanded)
	if err != nil {
		return fmt.Errorf("--root %q: resolve absolute path: %w", raw, err)
	}

	if name == "" {
		name = filepath.Base(abs)
	}
	if err := validateRootName(name); err != nil {
		return fmt.Errorf("--root %q: %w", raw, err)
	}
	for _, existing := range f.Specs {
		if existing.Name == name {
			return fmt.Errorf("--root %q: duplicate root name %q", raw, name)
		}
	}
	info, statErr := os.Stat(abs)
	if statErr != nil {
		return fmt.Errorf("--root %q: path %q does not exist: %w", raw, abs, statErr)
	}
	if !info.IsDir() {
		return fmt.Errorf("--root %q: path %q is not a directory", raw, abs)
	}

	f.Specs = append(f.Specs, files.RootSpec{Name: name, Path: abs})
	return nil
}

// JSON encodes f.Specs as the REVIEW_ROOTS JSON array, matching the format
// files.ParseRootsJSON expects ([{"name":...,"path":...}]). Returns "" when
// no --root flags were given.
func (f *RootFlag) JSON() (string, error) {
	if len(f.Specs) == 0 {
		return "", nil
	}
	b, err := json.Marshal(f.Specs)
	if err != nil {
		return "", fmt.Errorf("encode --root entries as JSON: %w", err)
	}
	return string(b), nil
}

// splitNamePath splits raw on the first '=' into (name, path), following the
// rule documented on RootFlag.Set: the part before '=' is only treated as a
// name if it contains no path separator.
func splitNamePath(raw string) (name, path string) {
	idx := strings.Index(raw, "=")
	if idx == -1 {
		return "", raw
	}
	candidate := raw[:idx]
	if strings.ContainsRune(candidate, '/') {
		return "", raw
	}
	return candidate, raw[idx+1:]
}

// validateRootName rejects names containing path separators or whitespace,
// mirroring files.NewRoots' own validation so --root fails fast at parse
// time instead of later inside the server.
func validateRootName(name string) error {
	if name == "" {
		return fmt.Errorf("root name must not be empty")
	}
	if name != filepath.Base(name) || name == "." || name == ".." {
		return fmt.Errorf("root name %q must not contain path separators", name)
	}
	if strings.ContainsAny(name, " \t\n") {
		return fmt.Errorf("root name %q must not contain whitespace", name)
	}
	return nil
}

// expandHome expands a leading "~" or "~/..." to the current user's home
// directory. Any other path is returned unchanged.
func expandHome(path string) (string, error) {
	if path != "~" && !strings.HasPrefix(path, "~/") {
		return path, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve home directory: %w", err)
	}
	if path == "~" {
		return home, nil
	}
	return filepath.Join(home, path[2:]), nil
}
