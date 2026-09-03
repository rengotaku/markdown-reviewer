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
  // Anchors authored here always carry an array, but ones read back from a
  // sidecar can be null when the document has no headings (#262), and the
  // resolve path below has to accept both.
  heading_path: string[] | null;
  snippet: string;
  occurrence: number;
}

/**
 * One anchorable unit (paragraph, heading, list item, table cell, code-block
 * line, …) flattened for anchoring. `start` is the ProseMirror position of
 * the unit's first text character; `end` is the position just past it.
 */
export interface AnchorBlock {
  start: number;
  end: number;
  text: string;
  /** Heading stack in effect at this unit, outermost first ("## Title" form). */
  headingStack: string[];
  /**
   * Identifies which Markdown *line* this unit came from (#163 / #164). The
   * backend (`internal/reviewstore/comments.go` ResolveAnchor) counts
   * `occurrence` per Markdown line, scanned with `strings.Split(content,
   * "\n")`. Most ProseMirror textblocks are already 1:1 with a Markdown
   * line, so they get a unique `lineGroup` each (same as an index). Two
   * structures break that 1:1 mapping and need `lineGroup` to fix it back up:
   *   - a fenced code block is *one* PM textblock spanning *N* Markdown
   *     lines — extractAnchorBlocks splits it into N units, each its own
   *     lineGroup (so none of them carry a literal "\n" in `text`, unlike
   *     the backend's per-line snippets).
   *   - a table row is *N* PM textblocks (one per cell) on *one* Markdown
   *     line — extractAnchorBlocks gives every cell in the row the same
   *     lineGroup, so counting groups (not units) agrees with the backend's
   *     one-line-one-occurrence-slot view.
   * occurrence counting (resolveAnchorInBlocks / computeAnchorInBlocks) is
   * therefore done per distinct `lineGroup`, not per unit.
   */
  lineGroup: number;
}

function suffixMatch(stack: string[], want: string[]): boolean {
  if (want.length > stack.length) return false;
  const off = stack.length - want.length;
  return want.every((w, i) => stack[off + i] === w);
}

// Leading block-level Markdown markers: blockquote `>`, bullet `-`/`*`/`+`,
// ordered `1.`/`1)`, and ATX heading `#`. Applied repeatedly so nested forms
// like "> - " and ">> " are peeled off too.
//
// Only `>` takes an optional trailing space: CommonMark accepts `>text` and
// `>>text`, whereas `-text`, `1.text` and `#text` are plain text, not list
// items or headings — requiring the space there keeps ordinary prose that
// happens to start with a hyphen or a digit from being mangled.
const BLOCK_MARKER = /^\s*(?:>\s*|[-*+]\s+|\d+[.)]\s+|#{1,6}\s+)/;

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
 * resolveAnchorInBlocks returns the PM range of the occurrence-th *Markdown
 * line* (`lineGroup`) that contains the snippet under a matching heading
 * path, or null when orphaned. The range covers the first snippet match
 * within the first unit of that line group (#163 / #164: a line group can
 * span several units — a table row's cells — and only the first match in
 * document order is addressable; see the accepted limitation on
 * `AnchorBlock.lineGroup`).
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

  const headingPath = anchor.heading_path ?? [];
  const underHeading = (b: AnchorBlock) =>
    !headingPath.length || suffixMatch(b.headingStack, headingPath);

  let groupsSeen = 0;
  let lastCountedGroup: number | null = null;
  for (const b of blocks) {
    const idx = b.text.indexOf(anchor.snippet);
    if (idx === -1 || !underHeading(b)) continue;
    // A later unit in the same lineGroup (e.g. another cell in the row we
    // already counted) is not a new occurrence.
    if (b.lineGroup === lastCountedGroup) continue;
    if (groupsSeen === anchor.occurrence) {
      const from = b.start + idx;
      return { from, to: from + anchor.snippet.length };
    }
    groupsSeen++;
    lastCountedGroup = b.lineGroup;
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
 * blocks[blockIndex]: the heading stack there, plus the count of distinct
 * earlier `lineGroup`s (document order) carrying the same snippet under the
 * same heading path. This is the inverse of resolveAnchorInBlocks.
 *
 * Counting is per `lineGroup`, not per unit (#163 / #164): an earlier unit
 * that shares blockIndex's own lineGroup (e.g. the sibling cell in the same
 * table row) is the *same* occurrence as the target, not a distinct prior
 * one, so it is excluded even though its array index is smaller.
 */
export function computeAnchorInBlocks(
  blocks: ReadonlyArray<AnchorBlock>,
  blockIndex: number,
  snippet: string
): PmAnchor {
  const target = blocks[blockIndex];
  const heading_path = target ? target.headingStack : [];
  const seenGroups = new Set<number>();
  for (let i = 0; i < blockIndex; i++) {
    const b = blocks[i];
    if (target && b.lineGroup === target.lineGroup) continue;
    // Exact matching only. Snippets authored here come from ProseMirror block
    // text, which never carries a block marker, so the #168 fallback has
    // nothing to do — and counting stripped matches would inflate `occurrence`
    // past what the exact-match resolve path will count back.
    if (b.text.indexOf(snippet) === -1) continue;
    if (heading_path.length && !suffixMatch(b.headingStack, heading_path)) continue;
    seenGroups.add(b.lineGroup);
  }
  return { heading_path, snippet, occurrence: seenGroups.size };
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

/**
 * extractAnchorBlocks flattens the document into anchorable units, walked
 * manually (rather than via `doc.descendants`) so table rows can thread a
 * shared `lineGroup` down to their cells' textblocks (#164) and fenced code
 * blocks can be split into one unit per Markdown line (#163) — both need
 * more context than a flat per-node callback exposes.
 */
export function extractAnchorBlocks(doc: ProseMirrorNode): AnchorBlock[] {
  const blocks: AnchorBlock[] = [];
  const headingStack: { text: string; level: number }[] = [];
  let nextLineGroup = 0;

  // `pos` is the ProseMirror position immediately before `parent` (-1 for the
  // document root, whose content starts at position 0). `rowGroup` is the
  // lineGroup shared by all cells of the table row currently being walked,
  // or null outside a table row.
  function walk(parent: ProseMirrorNode, pos: number, rowGroup: number | null): void {
    parent.forEach((child, offset) => {
      const childPos = pos + 1 + offset;

      if (child.type.name === "codeBlock") {
        // One PM textblock, N Markdown lines: split on "\n" so each line is
        // its own unit and none of them carry a literal newline (#163).
        const lines = child.textContent.split("\n");
        let lineStart = childPos + 1;
        for (const line of lines) {
          blocks.push({
            start: lineStart,
            end: lineStart + line.length,
            text: line,
            headingStack: headingStack.map((s) => s.text),
            lineGroup: nextLineGroup++,
          });
          lineStart += line.length + 1; // +1 skips the "\n" separator char.
        }
        return;
      }

      if (child.type.name === "heading") {
        const level = Number(child.attrs.level) || 1;
        while (headingStack.length && headingStack[headingStack.length - 1].level >= level) {
          headingStack.pop();
        }
        headingStack.push({
          text: `${"#".repeat(level)} ${child.textContent.trim()}`,
          level,
        });
      }

      if (child.isTextblock) {
        blocks.push({
          start: childPos + 1,
          end: childPos + child.nodeSize,
          text: child.textContent,
          headingStack: headingStack.map((s) => s.text),
          lineGroup: rowGroup ?? nextLineGroup++,
        });
        return;
      }

      if (child.type.name === "tableRow") {
        // One Markdown line, N PM textblocks (one per cell): every unit
        // found while walking this row shares one lineGroup (#164).
        walk(child, childPos, nextLineGroup++);
        return;
      }

      walk(child, childPos, rowGroup);
    });
  }

  walk(doc, -1, null);
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
