package main

import (
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"runtime"
	"strings"

	"markdown-reviewer/internal/reviewstore"
	"markdown-reviewer/internal/serverdefaults"
)

// baseURLEnv mirrors the server's hint override (internal/handler/hint.go):
// a full base URL, used as-is when set. It covers the reverse-proxy and
// port-forward cases where localhost:<PORT> is not how the UI is reached.
const baseURLEnv = "MARKDOWN_REVIEWER_BASE_URL"

// cmdOpen turns a file path into the web UI deeplink for that file and hands
// it to the browser. Callers only know filesystem paths; the `/{root}/{rel}`
// path the UI needs is derived here through the same resolvePath the other
// subcommands use, so the CLI and the UI address the same file.
func cmdOpen(args []string) error {
	pos, flags := parseArgs(args)
	if len(pos) < 1 {
		return fmt.Errorf("usage: mr open <path> [<extra-path>...] [--comment ID] [--print]")
	}
	base := baseURL(launchdPort)

	// Validate every positional argument — including the "at most one
	// out-of-root path" cap — before anything with a side effect runs.
	// registerAdhoc below purges whatever review currently occupies the
	// server's single ad-hoc slot (issue #240's PurgeRoot), so calling it
	// and *then* discovering a later argument violates the cap would have
	// already destroyed that review for a command that ends up refused
	// anyway. planOpen only ever calls the side-effect-free resolvePath.
	plan, err := planOpen(pos)
	if err != nil {
		return err
	}

	root, rel := plan.mainRoot, plan.mainRel
	if plan.mainNeedsAdhoc {
		// Outside every configured root: hand it to the server's ad-hoc
		// slot instead of refusing (issue #240). The original resolvePath
		// error is dropped on purpose — registerAdhoc's failure says more
		// about what to do next than "not under any configured root" does.
		root, rel, err = registerAdhoc(base, pos[0])
		if err != nil {
			return err
		}
	}
	commentID := flags["comment"]
	if commentID != "" {
		review, readErr := reviewstore.ReadReview(root, rel)
		if readErr != nil {
			return readErr
		}
		found := false
		for _, c := range review.Comments {
			if c.ID == commentID {
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("comment %q not found in %s", commentID, rel)
		}
	}
	extras := finalizeExtras(plan.extras, root)
	link := deeplink(base, root, rel, commentID, extras)
	// Printed before the launch so a launcher failure still leaves the caller
	// with a usable URL.
	fmt.Println(link)
	if flags["print"] != "" {
		return nil
	}
	launcher, err := browserCommandFor(runtime.GOOS)
	if err != nil {
		return err
	}
	if err := exec.Command(launcher, link).Run(); err != nil {
		return fmt.Errorf("launching the browser with %s failed (%w); the URL above still works", launcher, err)
	}
	return nil
}

// browserCommandFor names the "open this URL" helper for goos. Both release
// targets in .goreleaser.yaml are covered; anything else gets an explicit
// error rather than a guess, since the URL is already on stdout by then.
func browserCommandFor(goos string) (string, error) {
	switch goos {
	case "darwin":
		return "open", nil
	case "linux":
		return "xdg-open", nil
	default:
		return "", fmt.Errorf("no known browser launcher on %s; open the URL above manually (or use --print)", goos)
	}
}

// extraResolution is one additional positional path, resolved (or not)
// against the configured roots — computed by planOpen before anything with
// a side effect runs, and turned into deeplink `open=` rels by
// finalizeExtras once the main file's actual root is known.
type extraResolution struct {
	arg      string
	root     string
	rel      string
	resolved bool // false: resolvePath failed, i.e. outside every configured root
}

// openPlan is every positional argument to `mr open`, resolved against the
// configured roots with no side effects (resolvePath only — never
// registerAdhoc). cmdOpen only calls registerAdhoc, which purges whatever
// review currently occupies the ad-hoc slot, once a plan comes back without
// error: that ordering is the fix for issue #289 follow-up 1 (a rejected
// `mr open` used to purge the slot's existing review before rejecting).
type openPlan struct {
	mainRoot       string
	mainRel        string
	extras         []extraResolution
	mainNeedsAdhoc bool // pos[0] is outside every configured root
}

// planOpen resolves every positional argument against the configured roots
// and enforces the "at most one out-of-root path total" cap (main included
// — the server's single ad-hoc slot can't hold two files at once). It never
// calls registerAdhoc, so a plan that comes back with an error is guaranteed
// to not have touched the ad-hoc slot.
func planOpen(pos []string) (openPlan, error) {
	var plan openPlan
	outsideRootCount := 0

	mainRoot, mainRel, _, err := resolvePath(pos[0])
	if err != nil {
		plan.mainNeedsAdhoc = true
		outsideRootCount++
	} else {
		plan.mainRoot, plan.mainRel = mainRoot, mainRel
	}

	for _, p := range pos[1:] {
		root, rel, _, err := resolvePath(p)
		res := extraResolution{arg: p, resolved: err == nil, root: root, rel: rel}
		if err != nil {
			outsideRootCount++
			if outsideRootCount > 1 {
				return openPlan{}, fmt.Errorf("%q is outside every configured root; mr open supports at most one out-of-root path (the server's ad-hoc slot holds only one file)", p)
			}
		}
		plan.extras = append(plan.extras, res)
	}
	return plan, nil
}

// finalizeExtras turns a plan's extra resolutions into rel paths under
// mainRoot for the deeplink's `open=` params, once the main file's actual
// root is known (mainRoot is the ad-hoc slot's assigned name when the main
// path needed it, unknowable until after registerAdhoc runs). Paths outside
// every configured root, or under a different root than the main file,
// aren't representable as `open=<rel>` alongside the main path — they're
// reported on stderr and dropped rather than failing the whole command
// (fail-soft, issue #289).
func finalizeExtras(extras []extraResolution, mainRoot string) []string {
	rels := make([]string, 0, len(extras))
	for _, e := range extras {
		if !e.resolved {
			fmt.Fprintf(os.Stderr, "warning: %q is outside every configured root; skipping\n", e.arg)
			continue
		}
		if e.root != mainRoot {
			fmt.Fprintf(os.Stderr, "warning: %q is under root %q, not %q; skipping\n", e.arg, e.root, mainRoot)
			continue
		}
		rels = append(rels, e.rel)
	}
	return rels
}

// pathEscape mimics JS's `encodeURIComponent` (space -> %20, `/` -> %2F) so
// the URL round-trips through EditorPage's `decodeURIComponent`.
// `url.QueryEscape` already turns "/" into "%2F" like encodeURIComponent
// does — its one divergence is space -> "+" instead of "%20", fixed up here
// (a raw "+" would decode back to a literal "+", not a space, breaking file
// names with spaces).
func pathEscape(s string) string {
	return strings.ReplaceAll(url.QueryEscape(s), "+", "%20")
}

// deeplink builds the URL that opens rel in root: the `/{root}/{rel}` path
// EditorPage's `/:root/*` route reads on mount, with rel encoded as a single
// path segment (its own `/` separators become `%2F`) so multi-directory
// paths, spaces and multibyte segments all survive the round trip.
// `comment_id` stays a query param — it targets something within the opened
// file, not the file itself. Each entry in extraRels (root-relative, same
// root as rel) becomes a repeated `open=` param, opened as a background tab
// alongside the active one (issue #289); `extraRels` may be empty or nil.
func deeplink(base, root, rel, commentID string, extraRels []string) string {
	link := strings.TrimSuffix(base, "/") +
		"/" + pathEscape(root) +
		"/" + pathEscape(rel)
	query := url.Values{}
	if commentID != "" {
		query.Set("comment_id", commentID)
	}
	for _, extra := range extraRels {
		query.Add("open", extra)
	}
	if encoded := query.Encode(); encoded != "" {
		link += "?" + encoded
	}
	return link
}

// baseURL resolves where the server is reachable. Precedence, widest override
// first, mirroring the server's own deriveBaseURL:
//  1. MARKDOWN_REVIEWER_BASE_URL — the full base URL, proxies included.
//  2. PORT — the same env var the server honours, for a foreground run.
//  3. the launchd plist's PORT — the usual case: the agent holds the port and
//     this CLI runs without the agent's environment.
//  4. serverdefaults.Port — no agent installed, so the server is presumably
//     running in the foreground on the port it defaults to.
//
// plistPort is injected so the precedence is testable without a real plist.
func baseURL(plistPort func() (string, error)) string {
	if v := strings.TrimSpace(os.Getenv(baseURLEnv)); v != "" {
		return strings.TrimSuffix(v, "/")
	}
	port := strings.TrimSpace(os.Getenv("PORT"))
	if port == "" {
		if p, err := plistPort(); err == nil {
			port = strings.TrimSpace(p)
		}
	}
	if port == "" {
		port = serverdefaults.Port
	}
	return "http://localhost:" + port
}

// launchdPort reads PORT out of the launchd agent's plist, the same way
// rootsFromPlist reads REVIEW_ROOTS.
func launchdPort() (string, error) {
	return plistEnv("PORT")
}
