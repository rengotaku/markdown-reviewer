// pmAnchor computes and resolves content-derived comment anchors directly
// against the live ProseMirror document, so the editor can both author anchors
// (from a selection) and place inline highlights (from stored anchors) without
// round-tripping through the serialized markdown.
//
// The anchoring contract mirrors the backend (internal/reviewstore/comments.go):
// an anchor is heading_path + snippet + occurrence, resolved by scanning blocks
// (~ markdown lines) in document order for the occurrence-th block that both
// contains the snippet and whose heading stack suffix-matches heading_path.
//
// The pure functions operate on a flat AnchorBlock[] so they are unit-testable
// without a live editor; extractAnchorBlocks is the thin ProseMirror adapter.

import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export interface PmAnchor {
  heading_path: string[];
  snippet: string;
  occurrence: number;
}

/**
 * One document block (paragraph, heading, list item, …) flattened for
 * anchoring. `start` is the ProseMirror position of the block's first text
 * character; `end` is the position just past the block node.
 */
export interface AnchorBlock {
  start: number;
  end: number;
  text: string;
  /** Heading stack in effect at this block, outermost first ("## Title" form). */
  headingStack: string[];
}

function suffixMatch(stack: string[], want: string[]): boolean {
  if (want.length > stack.length) return false;
  const off = stack.length - want.length;
  return want.every((w, i) => stack[off + i] === w);
}

/**
 * resolveAnchorInBlocks returns the PM range of the occurrence-th block that
 * contains the snippet under a matching heading path, or null when orphaned.
 * The range covers the first snippet match within that block.
 */
export function resolveAnchorInBlocks(
  blocks: ReadonlyArray<AnchorBlock>,
  anchor: PmAnchor
): { from: number; to: number } | null {
  if (!anchor.snippet) return null;
  let seen = 0;
  for (const b of blocks) {
    const idx = b.text.indexOf(anchor.snippet);
    if (idx === -1) continue;
    if (anchor.heading_path.length && !suffixMatch(b.headingStack, anchor.heading_path)) {
      continue;
    }
    if (seen === anchor.occurrence) {
      const from = b.start + idx;
      return { from, to: from + anchor.snippet.length };
    }
    seen++;
  }
  return null;
}

/**
 * computeAnchorInBlocks builds the anchor for a snippet located in
 * blocks[blockIndex]: the heading stack there, plus the count of earlier blocks
 * (document order) carrying the same snippet under the same heading path. This
 * is the inverse of resolveAnchorInBlocks.
 */
export function computeAnchorInBlocks(
  blocks: ReadonlyArray<AnchorBlock>,
  blockIndex: number,
  snippet: string
): PmAnchor {
  const target = blocks[blockIndex];
  const heading_path = target ? target.headingStack : [];
  let occurrence = 0;
  for (let i = 0; i < blockIndex; i++) {
    const b = blocks[i];
    if (b.text.indexOf(snippet) === -1) continue;
    if (heading_path.length && !suffixMatch(b.headingStack, heading_path)) continue;
    occurrence++;
  }
  return { heading_path, snippet, occurrence };
}

/** blockIndexAtPos finds the block whose range contains the PM position. */
export function blockIndexAtPos(
  blocks: ReadonlyArray<AnchorBlock>,
  pos: number
): number {
  for (let i = 0; i < blocks.length; i++) {
    // start - 1 is the block node's own position (text starts one inside).
    if (pos >= blocks[i].start - 1 && pos < blocks[i].end) return i;
  }
  return -1;
}

/** extractAnchorBlocks flattens the document into anchorable blocks. */
export function extractAnchorBlocks(doc: ProseMirrorNode): AnchorBlock[] {
  const blocks: AnchorBlock[] = [];
  const stack: { text: string; level: number }[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const text = node.textContent;
    if (node.type.name === "heading") {
      const level = Number(node.attrs.level) || 1;
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ text: `${"#".repeat(level)} ${text.trim()}`, level });
    }
    blocks.push({
      start: pos + 1,
      end: pos + node.nodeSize,
      text,
      headingStack: stack.map((s) => s.text),
    });
    return false;
  });
  return blocks;
}

/** resolveAnchorInDoc resolves a stored anchor to a live PM range (or null). */
export function resolveAnchorInDoc(
  doc: ProseMirrorNode,
  anchor: PmAnchor
): { from: number; to: number } | null {
  return resolveAnchorInBlocks(extractAnchorBlocks(doc), anchor);
}

/**
 * computeAnchorFromSelection derives an anchor for the editor selection. The
 * snippet is clamped to the block holding the selection start so it stays on a
 * single line (matching the backend's line-based resolution).
 */
export function computeAnchorFromSelection(
  doc: ProseMirrorNode,
  from: number,
  to: number
): PmAnchor | null {
  const blocks = extractAnchorBlocks(doc);
  const idx = blockIndexAtPos(blocks, from);
  if (idx === -1) return null;
  const block = blocks[idx];
  const startOff = Math.max(0, from - block.start);
  const endOff = Math.min(block.text.length, to - block.start);
  const snippet = block.text.slice(startOff, endOff).trim();
  if (!snippet) return null;
  return computeAnchorInBlocks(blocks, idx, snippet);
}

/**
 * computeAnchorAtBlock builds an anchor covering an entire block's text — used
 * for cross-section comments that bind to whole headings.
 */
export function computeAnchorAtBlock(
  blocks: ReadonlyArray<AnchorBlock>,
  blockIndex: number
): PmAnchor | null {
  const block = blocks[blockIndex];
  if (!block) return null;
  const snippet = block.text.trim();
  if (!snippet) return null;
  return computeAnchorInBlocks(blocks, blockIndex, snippet);
}
