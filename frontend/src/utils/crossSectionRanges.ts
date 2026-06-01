/**
 * Resolve the doc text ranges (`from`/`to`) to wrap with block-scope comment
 * marks for a cross-section comment. Selected headings come from the picker
 * carrying just their `pos`; the heading node at that position is probed to
 * get its `nodeSize`, and the inner text range is `[pos+1, pos+nodeSize-1]`.
 *
 * Pulled out of EditorPage so the math can be unit-tested without spinning
 * up a real TipTap / ProseMirror instance.
 */

export interface NodeProbe {
  name: string;
  nodeSize: number;
}

export interface CrossSectionRange {
  from: number;
  to: number;
  /** Per-marker id minted by the caller (each anchored marker is unique). */
  id: string;
}

/**
 * Computes the wrap ranges for every selected heading whose probe still
 * resolves to a heading node with non-empty text content. Probes returning
 * a non-heading node or a zero-width range are skipped silently — they were
 * already invalid by the time the user hit submit (doc edits between dialog
 * open and submit, deleted heading, etc.).
 */
export function computeCrossSectionRanges(
  selectedHeadings: ReadonlyArray<{ pos: number }>,
  probe: (pos: number) => NodeProbe | null,
  newId: () => string
): CrossSectionRange[] {
  const out: CrossSectionRange[] = [];
  for (const h of selectedHeadings) {
    const node = probe(h.pos);
    if (!node || node.name !== "heading") continue;
    const from = h.pos + 1;
    const to = h.pos + node.nodeSize - 1;
    if (to <= from) continue;
    out.push({ from, to, id: newId() });
  }
  return out;
}
