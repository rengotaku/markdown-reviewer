// Command mr is the CLI front-end to a local markdown-reviewer instance. It
// lets an AI (or a human) read and respond to review comments with a plain
// shell command instead of building HTTP requests by hand — no URL escaping,
// no ?root= bookkeeping. Root resolution and the sidecar location mirror the
// server exactly (same internal packages), so the CLI and the web UI operate
// on the same review state.
//
//	mr inbox    [--root NAME] [--all]   files with open comments, newest first
//	mr comments <path> [--json] [--since ID] [--unanswered]   list comments
//	mr review   <path> [--all] [--since ID] [--unanswered]    AI-facing Markdown
//	mr reply    <path> <id> <text> [--author NAME] [--force]  add a threaded reply
//	mr resolve  <path> <id> [--force]  mark a comment resolved
//	mr reopen   <path> <id> [--force]  reopen a resolved comment
//	mr open     <path> [<extra-path>...] [--comment ID] [--print]  open the file in the web UI
//	mr revisions <path> [--json]  list revision history, newest first
//	mr restore  <path> <id> [--author NAME]  restore the canonical body to
//	                                          revision id (default author "external")
//	mr diff     <path> [--since ID] [--since-last-read]  unified diff against a
//	                                                       prior revision (default:
//	                                                       last_read's baseline)
//
// <path> may be absolute or relative to the current directory. It normally
// lives under one of the configured REVIEW_ROOTS. A path outside all of them
// is handled by the server's one-off ("anonymous") slot: `mr open` registers
// it there, and the other subcommands then work on it for as long as it is
// the file the slot holds.
//
// --since ID returns only comments numbered after ID (e.g. --since c-008) so a
// caller can spot what was added since its last look. --unanswered returns only
// comments whose latest activity is not from the AI (no reply, or the last
// reply is human) — both catch new top-level comments; --unanswered also catches
// fresh human replies on existing threads.
//
// `mr comments`/`mr review` stamp last_read.json on every successful read
// (sha + newest revision id + timestamp, #322) and print a "本文が変わって
// います" banner above their normal output whenever the body has drifted
// since the previous stamp. `mr reply`/`resolve`/`reopen` refuse to write
// (exit 1) when that same drift is detected, so a stale reading of the
// document cannot silently reply to or resolve text that has since changed
// — pass --force to write anyway. `mr diff` shows exactly what changed.
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"time"

	"markdown-reviewer/internal/reviewstore"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	args := os.Args[2:]
	var err error
	switch os.Args[1] {
	case "comments":
		err = cmdComments(args)
	case "review":
		err = cmdReview(args)
	case "inbox":
		err = cmdInbox(args)
	case "reply":
		err = cmdReply(args)
	case "resolve":
		err = cmdSetStatus(args, reviewstore.StatusResolved)
	case "reopen":
		err = cmdSetStatus(args, reviewstore.StatusOpen)
	case "open":
		err = cmdOpen(args)
	case "revisions":
		err = cmdRevisions(args)
	case "restore":
		err = cmdRestore(args)
	case "diff":
		err = cmdDiff(args)
	case "-h", "--help", "help":
		usage()
		return
	default:
		fmt.Fprintf(os.Stderr, "mr: unknown command %q\n\n", os.Args[1])
		usage()
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "mr: "+err.Error())
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprint(os.Stderr, `mr — markdown-reviewer CLI

Usage:
  mr inbox    [--root NAME] [--all]    files with open comments, newest first
  mr comments <path> [--json] [--since ID] [--unanswered]
  mr review   <path> [--all] [--since ID] [--unanswered]
  mr reply    <path> <id> <text> [--author NAME] [--force]
  mr resolve  <path> <id> [--force]    mark a comment resolved
  mr reopen   <path> <id> [--force]    reopen a resolved comment
  mr open     <path> [<extra-path>...] [--comment ID] [--print]  open the file in the web UI (--print: URL only)
  mr revisions <path> [--json]         list revision history, newest first
  mr restore  <path> <id> [--author NAME]  restore the canonical body to revision id (default author "external")
  mr diff     <path> [--since ID] [--since-last-read]  unified diff against a prior revision (default: last_read's baseline)

<path> is absolute or relative to cwd, normally under a configured root.
A path outside every root is registered as a one-off review by "mr open"; the
other subcommands then work on it while it is the file that slot holds.
"mr open" accepts extra paths after <path>: they open as background tabs
alongside <path> via repeated ?open= params. Extras must share <path>'s root;
a mismatched or unresolvable extra is dropped with a warning, and at most one
positional argument total may sit outside every configured root (the one-off
slot only holds one file).
--since ID: only comments after ID (e.g. --since c-008).
--unanswered: only comments whose latest activity is not from the AI.

mr comments/mr review record last_read.json on every successful read and
print a "本文が変わっています" banner when the body drifted since the last
one. mr reply/resolve/reopen refuse to write when that drift is detected
(pass --force to override); mr diff shows what changed.
`)
}

// readForReview resolves the path and loads canonical content + comments.
func readForReview(path string) (root, rel, content string, comments []reviewstore.Comment, err error) {
	root, rel, abs, err := resolveRegistered(path)
	if err != nil {
		return "", "", "", nil, err
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		return "", "", "", nil, err
	}
	raw := string(data)
	// Re-anchor after an out-of-band edit (the AI workflow edits the .md on
	// disk directly, bypassing the server's PUT re-anchor). A sync failure
	// must never block the read — worst case is the pre-sync orphans.
	if _, serr := reviewstore.SyncExternalEdit(root, rel, raw); serr != nil {
		fmt.Fprintln(os.Stderr, "mr: warning: external-edit sync failed: "+serr.Error())
	}
	// Backstop for the one path SyncExternalEdit's app-write marker leaves
	// open (#322): a Web UI save that nobody snapshotted via the "copy mr
	// comments" button (POST /api/revisions) never gets a revision, so an
	// AI reading straight from the terminal would silently overwrite the
	// human's edit with no recovery point. Best-effort, like the sync above.
	if berr := backstopHumanRevision(root, rel, raw); berr != nil {
		fmt.Fprintln(os.Stderr, "mr: warning: human-revision backstop failed: "+berr.Error())
	}
	review, err := reviewstore.ReadReview(root, rel)
	if err != nil {
		return "", "", "", nil, err
	}
	return root, rel, raw, review.Comments, nil
}

// backstopHumanRevision closes the gap SyncExternalEdit's app-write marker
// leaves (#322, see readForReview's call site for the scenario). It compares
// the current body to last_read — not to the newest stored revision, which
// may already equal the just-marked app-write content and so would never
// look "different" — and appends a "human" revision when they disagree.
// AppendRevision's own sha-dedupe keeps this a no-op whenever
// SyncExternalEdit already snapshotted this exact content moments earlier.
func backstopHumanRevision(root, rel, raw string) error {
	prior, ok, err := reviewstore.ReadLastRead(root, rel)
	if err != nil {
		return err
	}
	if !ok {
		return nil // no baseline yet; nothing to compare against
	}
	stripped := reviewstore.StripAIHint(raw)
	if prior.Sha == reviewstore.ShortSha(stripped) {
		return nil
	}
	_, _, err = reviewstore.AppendRevision(root, rel, "human", stripped)
	return err
}

func cmdComments(args []string) error {
	pos, flags := parseArgs(args)
	if len(pos) != 1 {
		return fmt.Errorf("usage: mr comments <path> [--json]")
	}
	root, rel, content, comments, err := readForReview(pos[0])
	if err != nil {
		return err
	}
	// The banner is stderr under --json so stdout stays parseable JSON.
	bannerOut := os.Stdout
	if flags["json"] != "" {
		bannerOut = os.Stderr
	}
	printDriftBanner(bannerOut, root, rel, comments, content)
	recordLastReadWarn(root, rel, content)

	comments = applyFilters(comments, flags)
	if flags["json"] != "" {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(comments)
	}
	renderReview(os.Stdout, rel, content, comments, false)
	return nil
}

func cmdReview(args []string) error {
	pos, flags := parseArgs(args)
	if len(pos) != 1 {
		return fmt.Errorf("usage: mr review <path> [--all]")
	}
	root, rel, content, comments, err := readForReview(pos[0])
	if err != nil {
		return err
	}
	printDriftBanner(os.Stdout, root, rel, comments, content)
	recordLastReadWarn(root, rel, content)

	comments = applyFilters(comments, flags)
	onlyOpen := flags["all"] == ""
	renderReview(os.Stdout, rel, content, comments, onlyOpen)
	return nil
}

// printDriftBanner writes driftBanner's output to w, if any. A failure to
// compute it is a warning on stderr, never a hard error — the read itself
// must still succeed.
func printDriftBanner(w io.Writer, root, rel string, comments []reviewstore.Comment, content string) {
	banner, err := driftBanner(root, rel, comments, content)
	if err != nil {
		fmt.Fprintln(os.Stderr, "mr: warning: drift banner failed: "+err.Error())
		return
	}
	if banner != "" {
		_, _ = fmt.Fprint(w, banner)
	}
}

// recordLastReadWarn stamps last_read.json after a tracked read, warning
// (not failing) on error — the read itself has already succeeded and must
// not be undone by bookkeeping that failed.
func recordLastReadWarn(root, rel, content string) {
	if err := recordLastRead(root, rel, content); err != nil {
		fmt.Fprintln(os.Stderr, "mr: warning: recording last-read failed: "+err.Error())
	}
}

// applyFilters narrows comments by the --since / --unanswered flags (no-op when
// neither is set), preserving order.
func applyFilters(comments []reviewstore.Comment, flags map[string]string) []reviewstore.Comment {
	if since := flags["since"]; since != "" {
		comments = commentsSince(comments, since)
	}
	if flags["unanswered"] != "" {
		comments = unansweredComments(comments)
	}
	return comments
}

func cmdReply(args []string) error {
	pos, flags := parseArgs(args)
	if len(pos) != 3 {
		return fmt.Errorf("usage: mr reply <path> <id> <text> [--author NAME] [--force]")
	}
	root, rel, abs, err := resolveRegistered(pos[0])
	if err != nil {
		return err
	}
	if gerr := checkWriteGuard(root, rel, abs, flags["force"] != ""); gerr != nil {
		return gerr
	}
	author := flags["author"]
	if author == "" {
		author = "ai"
	}
	cm, err := reviewstore.AddReply(root, rel, pos[1], reviewstore.Reply{
		Author: author,
		Date:   time.Now().Format("2006-01-02"),
		Body:   pos[2],
	})
	if err != nil {
		return err
	}
	fmt.Printf("replied to %s (%d 件目の返信)\n", cm.ID, len(cm.Replies))
	return nil
}

func cmdSetStatus(args []string, status string) error {
	pos, flags := parseArgs(args)
	if len(pos) != 2 {
		return fmt.Errorf("usage: mr %s <path> <id> [--force]", statusVerb(status))
	}
	root, rel, abs, err := resolveRegistered(pos[0])
	if err != nil {
		return err
	}
	if gerr := checkWriteGuard(root, rel, abs, flags["force"] != ""); gerr != nil {
		return gerr
	}
	cm, err := reviewstore.UpdateCommentStatus(root, rel, pos[1], status)
	if err != nil {
		return err
	}
	fmt.Printf("%s → %s\n", cm.ID, cm.Status)
	return nil
}

func statusVerb(status string) string {
	if status == reviewstore.StatusOpen {
		return "reopen"
	}
	return "resolve"
}

// valueFlags are the flags that consume the following token as their value.
// Everything else (--all, --json) is boolean, so positional/flag order stays
// free without the flag package's stricter model and without mistaking a
// positional path for a flag value.
var valueFlags = map[string]bool{"author": true, "since": true, "root": true, "comment": true}

// parseArgs splits args into positionals and flags. A flag is "--name"; it is
// boolean (stored as "true") unless it is in valueFlags, in which case the next
// token is taken as its value.
func parseArgs(args []string) (positional []string, flags map[string]string) {
	flags = map[string]string{}
	for i := 0; i < len(args); i++ {
		a := args[i]
		if len(a) > 2 && a[:2] == "--" {
			name := a[2:]
			if valueFlags[name] && i+1 < len(args) {
				flags[name] = args[i+1]
				i++
			} else {
				flags[name] = "true"
			}
			continue
		}
		positional = append(positional, a)
	}
	return positional, flags
}
