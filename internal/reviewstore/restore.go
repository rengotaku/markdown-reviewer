package reviewstore

// Restore computes the raw content the caller should write back to the
// canonical file to restore it to revision id (issue #282), plus whether
// that revision exists.
//
// Side effects performed here (not merely computed — this is a
// read-modify-write, not a pure function):
//   - the file's current raw content (hint-stripped) is appended as a new
//     revision via AppendRevision, *before* the target lookup below is
//     applied to the result. This means the state right before the restore
//     is never lost, and the restore itself can be undone by restoring
//     again — mirroring how AppendRevision already treats every save as a
//     point to return to.
//   - comment anchors are re-pointed from the current raw body to the
//     restored body via ReanchorReview (same machinery ReanchorOnSave and
//     SyncExternalEdit use), and review.json is persisted when anything
//     moved. Anchors that cannot be re-anchored stay untouched (honest
//     orphan), same policy as everywhere else in this package.
//
// currentRaw is the canonical file's current bytes verbatim (AI hint block
// included, exactly as ResolveAnchor/ReadFile deal in elsewhere) — the
// caller reads it right before calling Restore. author labels the "before
// restore" revision appended as a side effect.
//
// found=false (nil error) means no such revision id — including an
// un-ingested or history-less file, since GetRevision naturally reports "not
// found" for those without needing a separate ErrNotIngested-style check.
// The caller (HTTP handler / CLI) turns that into a 404 / non-zero exit.
func Restore(root, relPath, id, author, currentRaw string) (newRaw string, found bool, err error) {
	target, found, err := GetRevision(root, relPath, id)
	if err != nil {
		return "", false, err
	}
	if !found {
		return "", false, nil
	}

	// Snapshot what's about to be overwritten so the restore itself is
	// undoable and no history is lost. AppendRevision no-ops (ok=false, no
	// error) when content is unchanged since the last snapshot — that's fine,
	// it just means the current body already matches the newest revision.
	if _, _, aerr := AppendRevision(root, relPath, author, StripAIHint(currentRaw)); aerr != nil {
		return "", false, aerr
	}

	// The revision's Content is hint-stripped (see Revision doc comment); the
	// canonical file always carries the hint block at the top, so prepend
	// whatever hint block the current body has right now.
	restored := HintBlock(currentRaw) + target.Content

	review, rerr := ReadReview(root, relPath)
	if rerr != nil {
		return "", false, rerr
	}
	if len(review.Comments) > 0 {
		if updated, moved := ReanchorReview(review, currentRaw, restored); moved {
			if serr := saveReview(root, relPath, updated); serr != nil {
				return "", false, serr
			}
		}
	}

	return restored, true, nil
}
