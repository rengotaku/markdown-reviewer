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
	if len(pos) != 1 {
		return fmt.Errorf("usage: mr open <path> [--comment ID] [--print]")
	}
	base := baseURL(launchdPort)
	root, rel, _, err := resolvePath(pos[0])
	if err != nil {
		// Outside every configured root: hand it to the server's ad-hoc
		// slot instead of refusing (issue #240). The original error is
		// dropped on purpose — registerAdhoc's failure says more about what
		// to do next than "not under any configured root" does.
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
	link := deeplink(base, root, rel, commentID)
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
// file, not the file itself.
func deeplink(base, root, rel, commentID string) string {
	link := strings.TrimSuffix(base, "/") +
		"/" + pathEscape(root) +
		"/" + pathEscape(rel)
	if commentID != "" {
		link += "?comment_id=" + url.QueryEscape(commentID)
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
