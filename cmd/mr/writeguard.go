package main

import (
	"fmt"
	"os"

	"markdown-reviewer/internal/reviewstore"
)

// checkWriteGuard blocks `mr reply`/`resolve`/`reopen` when the canonical
// body has drifted since the caller's last tracked read (#322): those
// commands act on a comment's *meaning*, decided by a human or AI who read
// the document at some point, and if the body has since changed underneath
// them the reply/resolution may answer a version of the text that no longer
// exists. force=true (the command's --force flag) bypasses this
// unconditionally, mirroring `mr restore`'s existing escape hatches.
//
// The guard reads root/rel/abs directly rather than going through
// readForReview: it must NOT run SyncExternalEdit or the human-revision
// backstop as a side effect of a check that might end up blocking the write
// anyway — those belong to an actual read (`mr comments`/`mr review`), and
// this function does not call recordLastRead either, so a blocked write
// never moves the baseline the caller still needs to diff against.
func checkWriteGuard(root, rel, abs string, force bool) error {
	if force {
		return nil
	}
	prior, ok, err := reviewstore.ReadLastRead(root, rel)
	if err != nil {
		return err
	}
	if !ok {
		return nil // no baseline recorded yet; nothing to guard against
	}
	raw, err := os.ReadFile(abs)
	if err != nil {
		return err
	}
	stripped := reviewstore.StripAIHint(string(raw))
	if prior.Sha == reviewstore.ShortSha(stripped) {
		return nil
	}

	detail := ""
	if baseRev, found, gerr := reviewstore.GetRevision(root, rel, prior.RevID); gerr == nil && found {
		added, removed := lineDiffStats(baseRev.Content, stripped)
		// No revision covers this edit yet (the Web UI save → mr reply
		// without the copy button path, before readForReview's backstop
		// ever runs) — omit the author entirely rather than print the
		// meaningless placeholder "unknown".
		if revs, rerr := revisionsAfter(root, rel, prior.RevID); rerr == nil && len(revs) > 0 {
			detail = fmt.Sprintf("（+%d -%d, %s）", added, removed, revs[0].Author) // revisionsAfter is newest-first
		} else {
			detail = fmt.Sprintf("（+%d -%d）", added, removed)
		}
	}
	return fmt.Errorf(
		"この文書は最後に読んでから変更されています%s。\n"+
			"    mr diff %s --since-last-read で確認し、mr comments で読み直してから返信してください。\n"+
			"    （意図的に無視する場合のみ --force）",
		detail, rel,
	)
}
