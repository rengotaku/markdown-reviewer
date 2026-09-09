package reviewstore

import "strings"

// Reanchoring keeps comments attached to their content when a human edits the
// canonical body between saves. On PUT the server has both the old body (about
// to be overwritten) and the new body; an anchor that resolved against the old
// body but no longer resolves against the new one is a candidate for a
// re-anchor. We map the anchor's old line to a new line via a line-level LCS
// diff, and if that line was *changed* (not deleted) we rebuild the anchor from
// the new line's text + heading stack. If the line was deleted, or the rebuilt
// anchor still fails to resolve, we leave the anchor untouched (honest orphan)
// rather than guess a location.
//
// Resolving against the new body is not, by itself, proof that an anchor is
// still healthy (#287): when its Snippet is not unique under its heading
// (e.g. a repeated table cell value) and the matching lines get reordered,
// "the Occurrence-th match" can resolve to a *different* line than the one
// originally commented on — silently. Anchor.LineFingerprint (the resolved
// line's markup-stripped, trimmed text at the time the anchor was last known
// healthy) is what catches this: reanchorOne treats "resolves, but the
// resolved line's fingerprint no longer matches" the same as "does not
// resolve", running it through the same diff-based rebuild, and — when no
// rebuild recovers the true target — marking the anchor Orphan rather than
// leaving it silently pointing at the wrong line.

// ReanchorOnSave re-anchors the file's stored comments against the new
// canonical body and persists review.json when any anchor moved. It is the
// read-modify-write wrapper the write path calls; the pure re-anchor logic
// lives in ReanchorReview.
//
// It is a no-op (returns changed=false, nil) for files that are not ingested
// or that have no comments, preserving the existing write behavior. The caller
// invokes this BEFORE writing the new body to disk; see handler.WriteFile for
// the ordering rationale.
func ReanchorOnSave(root, relPath, oldCanonical, newCanonical string) (changed bool, err error) {
	if !HasEntry(root, relPath) {
		return false, nil
	}
	review, err := ReadReview(root, relPath)
	if err != nil {
		return false, err
	}
	if len(review.Comments) == 0 {
		return false, nil
	}
	updated, moved := ReanchorReview(review, oldCanonical, newCanonical)
	if !moved {
		return false, nil
	}
	if err := saveReview(root, relPath, updated); err != nil {
		return false, err
	}
	return true, nil
}

// ReanchorReview returns a copy of review with each comment's anchors
// re-pointed at the new canonical body where possible, plus whether anything
// changed. It is a pure function of its inputs (no I/O) so it is trivially
// testable; the caller persists the result.
//
// oldCanonical / newCanonical must be normalized identically to what the GET
// path feeds ResolveAnchor (see handler.readCanonical) — otherwise resolution
// here disagrees with resolution there and we mis-detect orphans.
//
// Comments with no anchors (global) and anchors that already resolve against
// the new body are left as-is.
func ReanchorReview(review Review, oldCanonical, newCanonical string) (Review, bool) {
	if len(review.Comments) == 0 {
		return review, false
	}

	oldLines := strings.Split(oldCanonical, "\n")
	newLines := strings.Split(newCanonical, "\n")
	newStacks := headingStacks(newCanonical)
	// old line index (0-based) -> new line index (0-based) for lines the diff
	// pairs as "same or changed in place". Deleted old lines are absent.
	lineMap := mapChangedLines(oldLines, newLines)

	changed := false
	// Work on a shallow copy of the comments slice so the input Review is not
	// mutated (Anchor pointers are replaced with fresh ones, never edited in
	// place).
	out := make([]Comment, len(review.Comments))
	copy(out, review.Comments)

	for ci := range out {
		cm := &out[ci]

		if cm.Anchor != nil {
			if newA, did := reanchorOne(*cm.Anchor, oldCanonical, newCanonical, newLines, newStacks, lineMap); did {
				cm.Anchor = &newA
				changed = true
			}
		}

		if len(cm.Anchors) > 0 {
			// Copy the slice before touching any element so the input is not
			// mutated when only some anchors move.
			anchors := make([]Anchor, len(cm.Anchors))
			copy(anchors, cm.Anchors)
			anyMoved := false
			for ai := range anchors {
				if newA, did := reanchorOne(anchors[ai], oldCanonical, newCanonical, newLines, newStacks, lineMap); did {
					anchors[ai] = newA
					anyMoved = true
				}
			}
			if anyMoved {
				cm.Anchors = anchors
				changed = true
			}
		}
	}

	if !changed {
		return review, false
	}
	newReview := review
	newReview.Comments = out
	return newReview, true
}

// reanchorOne tries to re-point a single anchor at the new body. It returns the
// rebuilt anchor and did=true only when something about the anchor changed:
// a real re-anchor to a new line, a fingerprint backfill on an
// otherwise-untouched anchor, an Orphan flag newly set or newly cleared, or a
// rebuild that recovers a previously-orphaned anchor. In every other case
// (already orphaned and still unrecoverable, its line was deleted with no
// rebuild possible) it returns did=false and the caller keeps the original
// anchor.
//
// Resolving against the new body is not enough to call an anchor healthy
// (#287): when its Snippet repeats many times under the same heading (e.g. a
// table's status column) and the matching lines are reordered, "the
// Occurrence-th match" can still resolve — to a different line than the one
// the comment was originally about. LineFingerprint (the line's
// markup-stripped, trimmed text at creation time) is what lets this function
// tell "resolves" apart from "resolves to the right line":
//
//   - No fingerprint recorded (pre-#287 data): trust the resolve as before,
//     but backfill the fingerprint of the resolved line so future saves are
//     protected. This is a known one-time gap for old data — if the line
//     had already silently moved before this feature shipped, the backfilled
//     fingerprint locks in the wrong line. Documented, not silently assumed.
//   - Fingerprint matches the resolved line: genuinely healthy. If the anchor
//     was Orphan (its target had vanished on some earlier save and the
//     deletion has now been undone, e.g. `mr restore`), the flag is cleared;
//     otherwise nothing changes.
//   - Fingerprint recorded but the resolved line's fingerprint differs: the
//     line moved elsewhere in the document; fall through to the recovery
//     paths below, which either find the true new location or mark/keep this
//     Orphan.
//
// probe (below) is a's Orphan flag forced to false before any internal
// ResolveAnchor call. ResolveAnchor's own entry-point Orphan gate exists so
// every *other* caller keeps treating an orphaned anchor as unresolved — but
// that same gate would stop this function from ever discovering that an
// orphaned anchor's original target came back, so internal checks use probe
// and only the final returned anchor's Orphan field is decided explicitly.
//
// Recovery, once the anchor is known to need it (does not resolve to its
// recorded target), is tried in two passes and — this order matters — the
// first must win:
//
//  1. The local diff (lineMap): the anchor's own line, if it still exists,
//     mapped from its old position to wherever the *same* line ended up.
//     This is the anchor's actual history and must be preferred.
//  2. A document-wide search for the anchor's exact old line text
//     (findLineByFingerprint), which recovers a *reordered* line — one the
//     diff cannot pair, since lineMap only pairs a deleted old line with an
//     insertion at the *same relative position* (an edit in place), whereas
//     reordering is a pure delete elsewhere paired with a pure insert
//     elsewhere.
//
// Trying step 2 first (as an earlier version of this function did) is a bug:
// if the anchor's own line was merely *edited* (its content still contains
// the snippet, so step 1 would find it), a full-body fingerprint scan can
// instead match a different, unrelated, unchanged line elsewhere in the
// document that happens to carry the exact same old text (e.g. the same
// snippet repeated under a different heading) — silently reattaching the
// comment to a stranger's line instead of following its own line's edit.
//
// Step 1 also cannot be trusted blindly (a second bug an earlier version had):
// ResolveAnchor(oldCanonical, probe) resolves by the same non-unique
// Snippet/HeadingPath/Occurrence rule that let the anchor mis-anchor in the
// first place, so oldIdx can itself land on the wrong line — most concretely,
// an already-Orphan anchor's own line is gone, so "resolving" it in the old
// body necessarily means it matched an unrelated line B purely because B also
// contains the Snippet. If B happens to be unchanged, lineMap maps straight
// through it and step 1 would "recover" onto B, permanently overwriting
// Orphan and LineFingerprint with B's identity — there is no signal left
// afterwards to tell this was wrong. So step 1 only proceeds when oldIdx's
// own fingerprint matches the one recorded on the anchor (or the anchor has
// no fingerprint: pre-#287 data keeps the old lineMap-only behavior). A
// mismatch here is not "orphan" — it just disqualifies this specific
// recovery path, so step 2 (fingerprint search) gets a chance instead.
func reanchorOne(
	a Anchor,
	oldCanonical, newCanonical string,
	newLines []string,
	newStacks [][]string,
	lineMap map[int]int,
) (Anchor, bool) {
	probe := a
	probe.Orphan = false

	silentlyMoved := false
	if _, ok := ResolveAnchor(newCanonical, probe); ok {
		newFP, fpOK := FingerprintAt(newCanonical, probe)
		switch {
		case probe.LineFingerprint == "":
			// No fingerprint on record: trust the resolve (matches
			// pre-#287 behavior) but backfill the fingerprint so this
			// anchor is protected going forward.
			if fpOK {
				backfilled := probe
				backfilled.LineFingerprint = newFP
				return backfilled, true
			}
			return a, false
		case fpOK && newFP == probe.LineFingerprint:
			// Genuinely healthy: resolves, and to the same line content.
			if a.Orphan {
				// The target this anchor originally meant is back (e.g. a
				// deletion was undone) — recover it.
				return probe, true
			}
			return a, false
		default:
			// Resolves, but to a line whose content no longer matches what
			// this anchor was made about — a silent move. Do not return
			// here; fall through to the recovery paths below, which will
			// either find the true new location or mark this Orphan.
			silentlyMoved = true
		}
	}

	// 1) The local diff: the anchor's own line, if the diff can still find
	// it (an edit in place, not a deletion). Must be tried before the
	// document-wide fingerprint search below — see the function doc comment.
	//
	// oldIdx itself must be trusted before using it: ResolveAnchor(old,
	// probe) resolves by the same Snippet/HeadingPath/Occurrence rule that
	// let the anchor mis-anchor in the first place, so when the Snippet is
	// not unique, oldIdx can land on some *other* line entirely — most
	// concretely, an already-Orphan anchor (whose own line is gone) matching
	// an unrelated, untouched line B merely because B also contains the
	// Snippet. lineMap would then map B's unchanged old/new position and
	// rebuildPreservingSnippet/rebuildAt would happily "recover" onto B,
	// permanently overwriting Orphan and LineFingerprint with B's — the
	// anchor can never find its real target again after that. So oldIdx is
	// only trusted when its own fingerprint matches the one recorded on the
	// anchor (or the anchor has no fingerprint at all: pre-#287 data, kept
	// on the old lineMap-only behavior for backward compatibility). A
	// mismatch here does not mean "orphan" — it means this specific recovery
	// path cannot be trusted, so step 2 below (a document-wide fingerprint
	// search) gets a chance instead.
	if oldRange, ok := ResolveAnchor(oldCanonical, probe); ok {
		oldIdx := oldRange[0] - 1 // ResolveAnchor returns 1-indexed lines
		trustworthy := true
		if probe.LineFingerprint != "" {
			oldFP, fpOK := FingerprintAt(oldCanonical, probe)
			trustworthy = fpOK && oldFP == probe.LineFingerprint
		}
		if trustworthy {
			if newIdx, mapped := lineMap[oldIdx]; mapped && newIdx >= 0 && newIdx < len(newLines) {
				// Prefer keeping the original Snippet: this diff-derived
				// newIdx is reached whenever the line's *text* changed
				// (that's what put it in lineMap as a same-position edit),
				// which commonly means only an unrelated cell on the same
				// row changed — e.g. editing a table row's 担当 column while
				// the anchor's own 状態 cell ("未対応") is untouched.
				// Rebuilding from the whole line in that case would regress a
				// previously-fine anchor to a pipe-bearing snippet the
				// frontend's per-cell block matching can never resolve (see
				// rebuildPreservingSnippet's doc comment).
				if rebuilt, ok := rebuildPreservingSnippet(probe, newCanonical, newLines, newStacks, newIdx); ok {
					return rebuilt, true
				}
				if rebuilt, ok := rebuildAt(probe, newCanonical, newLines, newStacks, newIdx); ok {
					return rebuilt, true
				}
			}
		}
	}

	// 2) A reordered line: lineMap has no counterpart for it (see above), so
	// search the whole new body for the anchor's exact old line text.
	if probe.LineFingerprint != "" {
		if newIdx, found := findLineByFingerprint(newLines, probe.LineFingerprint); found {
			if rebuilt, ok := rebuildPreservingSnippet(probe, newCanonical, newLines, newStacks, newIdx); ok {
				return rebuilt, true
			}
			if rebuilt, ok := rebuildAt(probe, newCanonical, newLines, newStacks, newIdx); ok {
				return rebuilt, true
			}
		}
	}

	// Nothing recovered a target. Flag Orphan only when this is new
	// information (a silent move that could not be resolved) — an anchor
	// that was already Orphan and still cannot be recovered has nothing new
	// to persist, so did=false avoids rewriting review.json on every save.
	if a.Orphan {
		return a, false
	}
	if silentlyMoved {
		orphaned := a
		orphaned.Orphan = true
		return orphaned, true
	}
	return a, false
}

// rebuildPreservingSnippet repoints a onto newLines[newIdx] while keeping
// a.Snippet untouched — only HeadingPath and Occurrence are recomputed (and
// LineFingerprint refreshed). This is the preferred repair whenever the
// original snippet still occurs on the target line, called from both
// reanchorOne callers that locate a newIdx:
//
//   - the fingerprint-based search (a line that moved elsewhere, found by its
//     recorded full-line fingerprint)
//   - the old->new lineMap diff (a line whose *text* changed in place) — this
//     commonly means an unrelated cell on the same row changed, e.g. editing
//     a table row's 担当 column while the anchor's own 状態 cell ("未対応")
//     is untouched
//
// In both cases, rebuilding from the whole line (rebuildAt) would regress a
// previously-fine anchor to a pipe-bearing snippet: the frontend resolves
// anchors against ProseMirror block text, and for a table row that text is
// the cell's own content with no pipe characters, so a table row's full
// stripped line never matches any frontend block — the highlight and "対象"
// jump go dead even though the backend resolves correctly. Keeping the
// original (frontend-shaped) snippet avoids that. ok=false when a.Snippet
// does not occur on newIdx (its text changed, not just its position/context)
// or the candidate still fails to resolve to newIdx; the caller falls back
// to rebuildAt in that case.
func rebuildPreservingSnippet(a Anchor, newCanonical string, newLines []string, newStacks [][]string, newIdx int) (Anchor, bool) {
	if !strings.Contains(stripInlineMarkup(newLines[newIdx]), a.Snippet) {
		return a, false
	}
	headingPath := a.HeadingPath
	if headingPath != nil {
		headingPath = append([]string(nil), newStacks[newIdx]...)
	}
	candidate := Anchor{
		Snippet:     a.Snippet,
		HeadingPath: headingPath,
		Occurrence:  occurrenceAtLine(newLines, newStacks, newIdx, a.Snippet, headingPath),
	}
	if fp, ok := FingerprintAt(newCanonical, candidate); ok {
		candidate.LineFingerprint = fp
	}
	if lr, ok := ResolveAnchor(newCanonical, candidate); !ok || lr[0] != newIdx+1 {
		return a, false
	}
	return candidate, true
}

// rebuildAt constructs a fresh anchor targeting newLines[newIdx] — snippet,
// heading path and occurrence all recomputed from that line — and confirms it
// actually resolves back to newIdx before handing it back. ok=false means
// newIdx has no stable text to anchor to (blank / markup-only) or the
// rebuilt anchor still fails to resolve to the intended line; the caller
// decides what to do with the original anchor in that case.
func rebuildAt(a Anchor, newCanonical string, newLines []string, newStacks [][]string, newIdx int) (Anchor, bool) {
	newSnippet := stripInlineMarkup(newLines[newIdx])
	if strings.TrimSpace(newSnippet) == "" {
		return a, false
	}
	rebuilt := Anchor{
		HeadingPath: append([]string(nil), newStacks[newIdx]...),
		Snippet:     newSnippet,
		Occurrence:  occurrenceAtLine(newLines, newStacks, newIdx, newSnippet, newStacks[newIdx]),
	}
	if fp, ok := FingerprintAt(newCanonical, rebuilt); ok {
		rebuilt.LineFingerprint = fp
	}
	// The rebuilt anchor must actually resolve to the intended line; if not,
	// abandon it.
	if lr, ok := ResolveAnchor(newCanonical, rebuilt); !ok || lr[0] != newIdx+1 {
		return a, false
	}
	return rebuilt, true
}

// findLineByFingerprint scans newLines in document order for the first line
// whose markup-stripped, trimmed text equals fingerprint. It underlies the
// #287 "the line moved elsewhere" recovery path: unlike the LCS-based
// lineMap, this is order-independent, so it finds a row/line that was
// reordered rather than edited in place. Ambiguity (more than one identical
// line) is resolved by taking the first match — the same honest-best-effort
// tradeoff ResolveAnchor already makes for repeated snippets.
func findLineByFingerprint(newLines []string, fingerprint string) (int, bool) {
	for i, line := range newLines {
		if strings.TrimSpace(stripInlineMarkup(line)) == fingerprint {
			return i, true
		}
	}
	return 0, false
}

// occurrenceAtLine computes the occurrence index a rebuilt anchor needs so that
// ResolveAnchor lands on targetIdx. It mirrors ResolveAnchor's matching exactly:
// a line counts when its markup-stripped text contains snippet AND its heading
// stack suffix-matches headingPath. The occurrence is the number of matching
// lines strictly before targetIdx.
func occurrenceAtLine(lines []string, stacks [][]string, targetIdx int, snippet string, headingPath []string) int {
	occ := 0
	for i := 0; i < targetIdx && i < len(lines); i++ {
		if !strings.Contains(stripInlineMarkup(lines[i]), snippet) {
			continue
		}
		if len(headingPath) > 0 && !headingSuffixMatch(stacks[i], headingPath) {
			continue
		}
		occ++
	}
	return occ
}

// mapChangedLines builds a map from old-line index to new-line index for lines
// the LCS diff treats as either unchanged or changed-in-place. It works by
// walking the LCS-derived edit script: an equal pair maps old->new; a deletion
// immediately followed by an insertion is treated as a change and maps the
// deleted old line to the inserted new line (positionally, pairing them in
// order). Pure deletions leave the old line unmapped so the caller treats them
// as removed.
func mapChangedLines(oldLines, newLines []string) map[int]int {
	ops := diffLines(oldLines, newLines)
	result := make(map[int]int)

	oi, ni := 0, 0
	i := 0
	for i < len(ops) {
		switch ops[i] {
		case opEqual:
			result[oi] = ni
			oi++
			ni++
			i++
		case opDelete:
			// Gather the run of consecutive deletions, then the run of
			// consecutive insertions that immediately follows. Pair them
			// positionally as changed lines; extras on either side are pure
			// delete / pure insert.
			delStart := oi
			for i < len(ops) && ops[i] == opDelete {
				oi++
				i++
			}
			insStart := ni
			for i < len(ops) && ops[i] == opInsert {
				ni++
				i++
			}
			delCount := oi - delStart
			insCount := ni - insStart
			pairs := delCount
			if insCount < pairs {
				pairs = insCount
			}
			for p := 0; p < pairs; p++ {
				result[delStart+p] = insStart + p
			}
		case opInsert:
			// Insertions with no preceding deletion: pure additions.
			ni++
			i++
		}
	}
	return result
}

// Edit-script op codes for the line diff.
const (
	opEqual = iota
	opDelete
	opInsert
)

// diffLines returns a line-level edit script (a sequence of opEqual / opDelete /
// opInsert) transforming oldLines into newLines, computed from a standard LCS
// table. No external dependency — Go's stdlib has no diff. The table is O(n*m)
// which is fine for review-sized markdown files.
func diffLines(oldLines, newLines []string) []int {
	n := len(oldLines)
	m := len(newLines)

	// lcs[i][j] = length of LCS of oldLines[i:] and newLines[j:].
	lcs := make([][]int, n+1)
	for i := range lcs {
		lcs[i] = make([]int, m+1)
	}
	for i := n - 1; i >= 0; i-- {
		for j := m - 1; j >= 0; j-- {
			if oldLines[i] == newLines[j] {
				lcs[i][j] = lcs[i+1][j+1] + 1
			} else if lcs[i+1][j] >= lcs[i][j+1] {
				lcs[i][j] = lcs[i+1][j]
			} else {
				lcs[i][j] = lcs[i][j+1]
			}
		}
	}

	var ops []int
	i, j := 0, 0
	for i < n && j < m {
		if oldLines[i] == newLines[j] {
			ops = append(ops, opEqual)
			i++
			j++
		} else if lcs[i+1][j] >= lcs[i][j+1] {
			ops = append(ops, opDelete)
			i++
		} else {
			ops = append(ops, opInsert)
			j++
		}
	}
	for i < n {
		ops = append(ops, opDelete)
		i++
	}
	for j < m {
		ops = append(ops, opInsert)
		j++
	}
	return ops
}
