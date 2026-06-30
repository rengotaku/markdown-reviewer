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
//	mr reply    <path> <id> <text> [--author NAME]   add a threaded reply
//	mr resolve  <path> <id>       mark a comment resolved
//	mr reopen   <path> <id>       reopen a resolved comment
//
// <path> may be absolute or relative to the current directory; it must live
// under one of the configured REVIEW_ROOTS.
//
// --since ID returns only comments numbered after ID (e.g. --since c-008) so a
// caller can spot what was added since its last look. --unanswered returns only
// comments whose latest activity is not from the AI (no reply, or the last
// reply is human) — both catch new top-level comments; --unanswered also catches
// fresh human replies on existing threads.
package main

import (
	"encoding/json"
	"fmt"
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
  mr reply    <path> <id> <text> [--author NAME]
  mr resolve  <path> <id>              mark a comment resolved
  mr reopen   <path> <id>              reopen a resolved comment

<path> is absolute or relative to cwd, and must be under a configured root.
--since ID: only comments after ID (e.g. --since c-008).
--unanswered: only comments whose latest activity is not from the AI.
`)
}

// readForReview resolves the path and loads canonical content + comments.
func readForReview(path string) (rel, content string, comments []reviewstore.Comment, err error) {
	root, rel, abs, err := resolvePath(path)
	if err != nil {
		return "", "", nil, err
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		return "", "", nil, err
	}
	review, err := reviewstore.ReadReview(root, rel)
	if err != nil {
		return "", "", nil, err
	}
	return rel, string(data), review.Comments, nil
}

func cmdComments(args []string) error {
	pos, flags := parseArgs(args)
	if len(pos) != 1 {
		return fmt.Errorf("usage: mr comments <path> [--json]")
	}
	rel, content, comments, err := readForReview(pos[0])
	if err != nil {
		return err
	}
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
	rel, content, comments, err := readForReview(pos[0])
	if err != nil {
		return err
	}
	comments = applyFilters(comments, flags)
	onlyOpen := flags["all"] == ""
	renderReview(os.Stdout, rel, content, comments, onlyOpen)
	return nil
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
		return fmt.Errorf("usage: mr reply <path> <id> <text> [--author NAME]")
	}
	root, rel, _, err := resolvePath(pos[0])
	if err != nil {
		return err
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
	pos, _ := parseArgs(args)
	if len(pos) != 2 {
		return fmt.Errorf("usage: mr %s <path> <id>", statusVerb(status))
	}
	root, rel, _, err := resolvePath(pos[0])
	if err != nil {
		return err
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
var valueFlags = map[string]bool{"author": true, "since": true, "root": true}

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
