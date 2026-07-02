package reviewstore

import "path/filepath"

// SyncExternalEdit reconciles review state with an out-of-band edit of the
// canonical file — the main AI workflow edits the .md directly on disk (never
// through PUT /api/files), so ReanchorOnSave, which only the write path calls,
// never fires and every AI edit orphaned its comments (#61). Read paths call
// this before resolving anchors so the existing re-anchor machinery covers
// external edits too.
//
// rawContent is the canonical file exactly as read from disk (AI hint block
// included) — the same bytes the caller feeds ResolveAnchor afterwards, so
// rebuilt anchors are guaranteed to resolve for that caller. Drift detection
// compares hint-stripped shas, mirroring how revisions are stored, so hint
// churn alone never counts as an edit.
//
// Behavior:
//   - draft (un-ingested) file: no-op.
//   - no history yet: snapshot rawContent (hint-stripped) as the baseline and
//     return synced=false — there is no old body to re-anchor from.
//   - sha matches the newest revision: no-op.
//   - drifted: re-anchor comments from the newest snapshot to rawContent,
//     persist review.json when anything moved, and append the new content as
//     an "external" revision. Anchors that cannot be re-anchored stay
//     untouched (honest orphan), same policy as ReanchorReview.
//
// The old body fed to the re-anchor diff is the stored snapshot, which is
// hint-stripped while the original anchors were authored against hinted
// content. That asymmetry is harmless: the hint block never contains anchored
// user text, and pure insertions/deletions of it are ignored by the line diff.
//
// There is no file lock (the store has none anywhere), so two concurrent
// callers can both detect the same drift. The review.json outcome is still
// correct — ReanchorReview is pure and both writers persist identical results —
// but history.jsonl may transiently gain a duplicate revision entry when the
// second caller's AppendRevision reads history before the first one's write
// lands (its sha dedupe only sees committed entries).
func SyncExternalEdit(root, relPath, rawContent string) (synced bool, err error) {
	if !HasEntry(root, relPath) {
		return false, nil
	}
	dir, err := EntryDir(root, relPath)
	if err != nil {
		return false, err
	}
	revs, err := readRevisions(filepath.Join(dir, historyFile))
	if err != nil {
		return false, err
	}

	stripped := StripAIHint(rawContent)
	if len(revs) == 0 {
		_, _, aerr := AppendRevision(root, relPath, externalAuthor, stripped)
		return false, aerr
	}
	newest := revs[len(revs)-1]
	if newest.Sha == shortSha(stripped) {
		return false, nil
	}

	review, err := ReadReview(root, relPath)
	if err != nil {
		return false, err
	}
	moved := false
	if updated, didMove := ReanchorReview(review, newest.Content, rawContent); didMove {
		if err := saveReview(root, relPath, updated); err != nil {
			return false, err
		}
		moved = true
	}
	if _, _, aerr := AppendRevision(root, relPath, externalAuthor, stripped); aerr != nil {
		// review.json may already be re-anchored at this point; report
		// synced=moved so the partial write is not misreported as "nothing
		// happened". The next call retries the append (sha still drifts).
		return moved, aerr
	}
	return true, nil
}

// externalAuthor labels revisions snapshotted from out-of-band edits, where
// the actual author (AI via a file tool, human via a text editor) is unknown.
const externalAuthor = "external"
