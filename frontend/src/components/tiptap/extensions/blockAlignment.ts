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
 * Walks the units the gutters label, in document order (#368): each
 * top-level child except blank-line paragraphs, with lists replaced by their
 * items (an item followed by the items of its directly nested lists) and
 * tables by their rows. This must produce the same units in the same order
 * as gutterUnitRanges() does on the markdown side.
 */
function forEachUnit(doc: ProseMirrorNode, visit: (offset: number, node: ProseMirrorNode) => void) {
  doc.forEach((node, offset) => {
    if (isBlankLineParagraph(node)) return;
    if (LIST_TYPES.has(node.type.name)) {
      forEachListItem(node, offset, visit);
    } else if (node.type.name === "table") {
      node.forEach((row, rowOffset) => visit(offset + 1 + rowOffset, row));
    } else {
      visit(offset, node);
    }
  });
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

/**
 * contentBlocks returns the gutter units of doc in order (see forEachUnit),
 * so index i lines up with markdown-it's i-th unit.
 */
export function contentBlocks(doc: ProseMirrorNode): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  forEachUnit(doc, (offset, node) => blocks.push({ offset, node }));
  return blocks;
}

/**
 * Number of blocks contentBlocks() would return, without building the array.
 * The gutter plugins only need the count on their per-keystroke path (#270),
 * where allocating one object per unit is the thing being avoided.
 */
export function contentBlockCount(doc: ProseMirrorNode): number {
  let n = 0;
  forEachUnit(doc, () => {
    n += 1;
  });
  return n;
}
