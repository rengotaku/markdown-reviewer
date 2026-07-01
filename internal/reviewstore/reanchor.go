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
// rebuilt anchor and did=true only when a re-anchor actually happened. In every
// other case (already resolves, was already orphaned, its line was deleted, or
// the rebuilt anchor fails to resolve) it returns did=false and the caller
// keeps the original anchor.
func reanchorOne(
	a Anchor,
	oldCanonical, newCanonical string,
	newLines []string,
	newStacks [][]string,
	lineMap map[int]int,
) (Anchor, bool) {
	// Already resolves against the new body: nothing to do.
	if _, ok := ResolveAnchor(newCanonical, a); ok {
		return a, false
	}
	// Does not resolve in old body either: it was already an orphan; do not
	// touch it.
	oldRange, ok := ResolveAnchor(oldCanonical, a)
	if !ok {
		return a, false
	}
	oldIdx := oldRange[0] - 1 // ResolveAnchor returns 1-indexed lines
	newIdx, mapped := lineMap[oldIdx]
	if !mapped {
		// Old line was deleted (no counterpart in the new body): honest orphan.
		return a, false
	}
	if newIdx < 0 || newIdx >= len(newLines) {
		return a, false
	}

	newSnippet := stripInlineMarkup(newLines[newIdx])
	if strings.TrimSpace(newSnippet) == "" {
		// The changed line has no stable text to anchor to (blank / markup
		// only); leave the anchor as an honest orphan.
		return a, false
	}

	rebuilt := Anchor{
		HeadingPath: append([]string(nil), newStacks[newIdx]...),
		Snippet:     newSnippet,
		Occurrence:  occurrenceAtLine(newLines, newStacks, newIdx, newSnippet, newStacks[newIdx]),
	}

	// The rebuilt anchor must actually resolve to the intended line; if not,
	// abandon the re-anchor and keep the original (honest orphan).
	if lr, ok := ResolveAnchor(newCanonical, rebuilt); !ok || lr[0] != newIdx+1 {
		return a, false
	}
	return rebuilt, true
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
