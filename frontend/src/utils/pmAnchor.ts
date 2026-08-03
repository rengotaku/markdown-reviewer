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

// Leading block-level Markdown markers: blockquote `>`, bullet `-`/`*`/`+`,
// ordered `1.`/`1)`, and ATX heading `#`. Applied repeatedly so nested forms
// like "> - " are peeled off too.
const BLOCK_MARKER = /^\s*(?:>|[-*+]|\d+[.)]|#{1,6})\s+/;

/**
 * stripBlockMarkers removes leading block-level Markdown markers from a
 * snippet (#168). The backend resolves anchors against raw Markdown *lines*,
 * which carry these markers, while the editor resolves against ProseMirror
 * block text, which does not — a list item's textContent has no "1. " and a
 * blockquote's has no "> ". Snippets written by AI clients sit in between
 * (inline markup stripped, block markers kept), so the reading side has to
 * tolerate them or the highlight and the jump both silently do nothing.
 */
export function stripBlockMarkers(snippet: string): string {
  let out = snippet;
  for (;;) {
    const next = out.replace(BLOCK_MARKER, "");
    if (next === out) return out;
    out = next;
  }
}

/**
 * resolveAnchorInBlocks returns the PM range of the occurrence-th block that
 * contains the snippet under a matching heading path, or null when orphaned.
 * The range covers the first snippet match within that block.
 *
 * Exact matching runs first and owns `occurrence`. Only when it finds nothing
 * does the marker-stripped fallback run (#168), and that fallback deliberately
 * ignores `occurrence`: the number was counted by whoever wrote the anchor
 * against raw Markdown lines (which carry the marker), so it does not index
 * into the stripped-match set. Guessing an index across those two different
 * numbering schemes would point at a confidently wrong line — e.g. "1. 同じ文"
 * and "2. 同じ文" under one heading both strip to "同じ文", and the backend's
 * `occurrence: 0` for "2. 同じ文" means the second item, not the first. So the
 * fallback only commits when it is unambiguous, and otherwise reports the
 * honest orphan.
 */
export function resolveAnchorInBlocks(
  blocks: ReadonlyArray<AnchorBlock>,
  anchor: PmAnchor
): { from: number; to: number } | null {
  if (!anchor.snippet) return null;

  const underHeading = (b: AnchorBlock) =>
    !anchor.heading_path.length || suffixMatch(b.headingStack, anchor.heading_path);

  let seen = 0;
  for (const b of blocks) {
    const idx = b.text.indexOf(anchor.snippet);
    if (idx === -1 || !underHeading(b)) continue;
    if (seen === anchor.occurrence) {
      const from = b.start + idx;
      return { from, to: from + anchor.snippet.length };
    }
    seen++;
  }

  const bare = stripBlockMarkers(anchor.snippet);
  if (bare === anchor.snippet || !bare) return null;
  const candidates = blocks.filter(
    (b) => underHeading(b) && b.text.includes(bare)
  );
  if (candidates.length !== 1) return null;
  const from = candidates[0].start + candidates[0].text.indexOf(bare);
  return { from, to: from + bare.length };
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
    // Exact matching only. Snippets authored here come from ProseMirror block
    // text, which never carries a block marker, so the #168 fallback has
    // nothing to do — and counting stripped matches would inflate `occurrence`
    // past what the exact-match resolve path will count back.
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
 * computeAnchorsFromSelection derives one anchor per block the selection
 * touches (#162): a multi-line selection used to be clamped to whichever
 * block held its start, which both lost the trailing blocks and — when the
 * start landed exactly at a block's line end — produced an empty snippet and
 * failed outright. Each touched block is anchored to its own overlap with the
 * selection; blocks whose overlap trims to nothing (selection starts at a
 * line end / ends at a line head / whitespace-only) are skipped rather than
 * failing the whole selection. A single-block selection yields exactly the
 * same single-element result as before, so this is a drop-in replacement.
 */
export function computeAnchorsFromSelection(
  doc: ProseMirrorNode,
  from: number,
  to: number
): PmAnchor[] {
  const blocks = extractAnchorBlocks(doc);
  const anchors: PmAnchor[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    // Mirrors blockIndexAtPos's single-position window test, generalized to a
    // range: the block is touched when the selection intersects its node span.
    if (to <= block.start - 1 || from >= block.end) continue;
    const startOff = Math.max(0, Math.min(block.text.length, from - block.start));
    const endOff = Math.max(0, Math.min(block.text.length, to - block.start));
    const snippet = block.text.slice(startOff, endOff).trim();
    if (!snippet) continue;
    anchors.push(computeAnchorInBlocks(blocks, i, snippet));
  }
  return anchors;
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
