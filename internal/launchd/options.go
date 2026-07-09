package launchd

import (
	"errors"
	"fmt"
	"os"
	"strings"
)

// Options configures Install/Uninstall/Status. Zero values are filled in by
// ResolveOptions with the documented defaults / env fallbacks before use.
type Options struct {
	// Label is the launchd agent label, and the plist filename
	// (<Label>.plist). Defaults to DefaultLabel.
	Label string
	// Port is the PORT env var baked into the plist. Defaults to DefaultPort.
	Port string
	// ReviewRoots is the REVIEW_ROOTS JSON array baked into the plist.
	// Falls back to the REVIEW_ROOTS env var when empty.
	ReviewRoots string
	// ReviewRoot is the REVIEW_ROOT single-directory value baked into the
	// plist. Falls back to the REVIEW_ROOT env var when empty.
	ReviewRoot string
}

// usageExample is shown when install is invoked with neither
// --review-roots/--review-root nor the corresponding env vars set.
const usageExample = `REVIEW_ROOTS or REVIEW_ROOT must be set (as a flag or environment variable).

Examples:
  markdown-review-server service install --review-root "$HOME/notes"
  markdown-review-server service install --review-roots '[{"name":"notes","path":"'"$HOME"'/notes"}]'
  REVIEW_ROOT="$HOME/notes" markdown-review-server service install`

// ResolveOptions fills unset fields of opts with defaults and environment
// fallbacks, then validates the result. requireRoots should be true for
// install (where a root config is mandatory) and false for
// uninstall/status (which don't need one).
func ResolveOptions(opts Options, requireRoots bool) (Options, error) {
	resolved := opts
	if resolved.Label == "" {
		resolved.Label = DefaultLabel
	}
	if resolved.Port == "" {
		resolved.Port = DefaultPort
	}
	if resolved.ReviewRoots == "" {
		resolved.ReviewRoots = os.Getenv("REVIEW_ROOTS")
	}
	if resolved.ReviewRoot == "" {
		resolved.ReviewRoot = os.Getenv("REVIEW_ROOT")
	}

	if strings.ContainsAny(resolved.Label, "/ \t\n") || resolved.Label == "" {
		return Options{}, fmt.Errorf("invalid --label %q: must be non-empty and contain no path separators or whitespace", resolved.Label)
	}

	if requireRoots && resolved.ReviewRoots == "" && resolved.ReviewRoot == "" {
		return Options{}, errors.New(usageExample)
	}

	return resolved, nil
}
