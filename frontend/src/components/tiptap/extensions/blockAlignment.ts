import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

// Shared helper for DiffGutter/LineNumberGutter: both plugins receive a
// payload indexed by markdown-it's unit order (top-level blocks, with lists
// and tables split into items and rows — #368) and need to find the matching
// ProseMirror node to decorate.
//
// Since #261, blank lines are represented as real empty paragraph nodes in
// the doc (BlankLines.ts inserts them on load; typing Enter/Backspace adds
// or removes them like any other paragraph) rather than as an attribute on
// the following block. markdown-it never emits a block for a blank line, so
// those paragraphs — and the phantom empty paragraph tiptap appends after a
// trailing table/list/code block (#125) — have to be filtered out before
// lining up doc children with markdown-it's block index.
//
// An empty paragraph is indistinguishable from "the phantom trailing
// paragraph" by node shape alone, but that's fine here: neither one is a
// markdown-it block, so both are correctly excluded from this alignment by
// the same rule.

/** True for a paragraph with no content — a blank source line once loaded,
 *  or one freshly created by pressing Enter twice / Backspace-ing down to
 *  an empty line. */
export function isBlankLineParagraph(node: ProseMirrorNode): boolean {
  return node.type.name === "paragraph" && node.content.size === 0;
}

export interface ContentBlock {
  /** ProseMirror position immediately before the node (pass to
   *  Decoration.node(offset, offset + node.nodeSize, ...)). */
  offset: number;
  node: ProseMirrorNode;
}

const LIST_TYPES = new Set(["bulletList", "orderedList", "taskList"]);

/**
 * Walks the units the gutters label within one top-level child, in document
 * order (#368): lists are replaced by their items (an item followed by the
 * items of its directly nested lists) and tables by their rows; any other
 * block is a unit by itself. This must produce the same units in the same
 * order as gutterUnitRanges() does on the markdown side.
 */
function forEachUnitIn(
  node: ProseMirrorNode,
  offset: number,
  visit: (offset: number, node: ProseMirrorNode) => void
) {
  if (LIST_TYPES.has(node.type.name)) {
    forEachListItem(node, offset, visit);
  } else if (node.type.name === "table") {
    node.forEach((row, rowOffset) => visit(offset + 1 + rowOffset, row));
  } else {
    visit(offset, node);
  }
}

function forEachListItem(
  list: ProseMirrorNode,
  listOffset: number,
  visit: (offset: number, node: ProseMirrorNode) => void
) {
  list.forEach((item, itemOffset) => {
    const offset = listOffset + 1 + itemOffset;
    visit(offset, item);
    item.forEach((child, childOffset) => {
      if (LIST_TYPES.has(child.type.name)) forEachListItem(child, offset + 1 + childOffset, visit);
    });
  });
}

/** Top-level children in order, skipping blank-line paragraphs. */
function topLevelBlocks(doc: ProseMirrorNode): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  doc.forEach((node, offset) => {
    if (!isBlankLineParagraph(node)) blocks.push({ offset, node });
  });
  return blocks;
}

/**
 * alignUnits returns, for each of markdown-it's units, the node to decorate,
 * or null when the doc can't be lined up with them.
 *
 * `groupSizes[i]` is how many units markdown-it found in its i-th top-level
 * block. The two parsers don't always split a block the same way — a list
 * mixing plain and task items comes out of tiptap-markdown as several
 * lists, sometimes with an extra empty task item — so the units are
 * compared block by block, and a block whose counts differ falls back to
 * being labelled as a whole: every one of its units maps to the top-level
 * node. Only a disagreement on the top-level blocks themselves gives up on
 * the whole doc, as before #368.
 *
 * Without `groupSizes`, the doc's units must match `unitCount` one to one.
 */
export function alignUnits(
  doc: ProseMirrorNode,
  unitCount: number,
  groupSizes?: number[]
): ContentBlock[] | null {
  const targets: ContentBlock[] = [];
  if (!groupSizes) {
    doc.forEach((node, offset) => {
      if (isBlankLineParagraph(node)) return;
      forEachUnitIn(node, offset, (o, n) => targets.push({ offset: o, node: n }));
    });
    return targets.length === unitCount ? targets : null;
  }

  const blocks = topLevelBlocks(doc);
  if (blocks.length !== groupSizes.length) return null;
  blocks.forEach((block, index) => {
    const units: ContentBlock[] = [];
    forEachUnitIn(block.node, block.offset, (o, n) => units.push({ offset: o, node: n }));
    if (units.length === groupSizes[index]) targets.push(...units);
    else for (let k = 0; k < groupSizes[index]; k++) targets.push(block);
  });
  return targets.length === unitCount ? targets : null;
}

/**
 * Number of units the doc itself has (see forEachUnitIn), without building
 * an array. The gutter plugins only need the count on their per-keystroke
 * path (#270), where allocating one object per unit is the thing being
 * avoided: a change in this count means the edit added or removed a unit.
 */
export function contentBlockCount(doc: ProseMirrorNode): number {
  let n = 0;
  doc.forEach((node, offset) => {
    if (isBlankLineParagraph(node)) return;
    forEachUnitIn(node, offset, () => {
      n += 1;
    });
  });
  return n;
}
