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
	// Our own (auto)save, not an external edit (#280): its comments were
	// already re-anchored on the write path, and snapshotting it here would
	// put one revision per save back into history under the "external" label.
	if isAppWrite(dir, shortSha(stripped)) {
		return false, nil
	}
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

// SnapshotIngestBaseline records rawContent as the ingested file's first
// revision, when it does not already have history.
//
// Without this, an edit made between Ingest and the first GET is invisible
// to SyncExternalEdit's drift detection (#287 follow-up): its
// len(revs)==0 branch treats whichever body the *first* read happens to see
// as the retroactive baseline, so a comment anchored just after ingest whose
// target line was silently moved by that edit is never re-anchored — there
// is no "old" snapshot left to diff the edit against, so the very drift the
// read path exists to detect is invisible. Concretely: ingest → comment
// anchored to line 5 → file rewritten with that line moved to line 7,
// without any GET in between → the first GET afterwards adopts the rewritten
// body as ground truth and reports the comment still healthy at line 5's
// new (wrong) occupant.
//
// This is a best-effort snapshot: a failure here must not fail Ingest, so
// callers should log and continue rather than propagate the error to the
// client. A file that already has history — including a second Ingest of an
// already-managed file — is left untouched: baselining is only meaningful
// once, at the very first ingest, and skipping the call entirely (rather
// than relying solely on AppendRevision's sha dedupe) also means a repeat
// ingest never even risks growing history.
//
// author is externalAuthor, the same label SyncExternalEdit uses for its own
// snapshots: a baseline, like an out-of-band edit snapshot, is not
// attributable to a specific save action.
func SnapshotIngestBaseline(root, relPath, rawContent string) error {
	dir, err := EntryDir(root, relPath)
	if err != nil {
		return err
	}
	revs, err := readRevisions(filepath.Join(dir, historyFile))
	if err != nil {
		return err
	}
	if len(revs) > 0 {
		return nil // already has history; nothing to baseline
	}
	_, _, err = AppendRevision(root, relPath, externalAuthor, StripAIHint(rawContent))
	return err
}
