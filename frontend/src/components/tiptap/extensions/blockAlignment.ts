import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

// Shared helper for DiffGutter/LineNumberGutter: both plugins receive a
// payload indexed by markdown-it's top-level block order and need to find
// the matching ProseMirror node to decorate.
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

/**
 * contentBlocks returns doc's top-level children in order, skipping blank
 * -line paragraphs, so index i lines up with markdown-it's i-th block.
 */
export function contentBlocks(doc: ProseMirrorNode): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  doc.forEach((node, offset) => {
    if (isBlankLineParagraph(node)) return;
    blocks.push({ offset, node });
  });
  return blocks;
}
