import MarkdownIt from "markdown-it";
import { lineDiff } from "@/utils/lineDiff";

// diffGutterMarks computes which top-level Markdown blocks (headings,
// paragraphs, lists, ...) differ from a baseline revision, so the editor can
// paint a VSCode-git-gutter-style colored bar in the left margin (#121).
//
// Block boundaries come from markdown-it's tokenizer rather than the
// ProseMirror doc directly: it's cheap to run on plain text and gives us
// 0-indexed [start, end) line ranges we can intersect with lineDiff's
// line-level diff. The caller (DiffGutter extension) cross-checks the
// resulting blockCount against the live doc's childCount before trusting the
// block indices, since the two parsers can in principle diverge.

const md = new MarkdownIt({ html: true });

// Token types that open a top-level block and carry a `.map` line range on
// the *_open token itself.
const BLOCK_OPEN_TYPES = new Set([
  "heading_open",
  "paragraph_open",
  "blockquote_open",
  "bullet_list_open",
  "ordered_list_open",
  "table_open",
]);

// Token types that are a complete block in a single token (no matching
// *_close pair) but still carry `.map`.
const BLOCK_STANDALONE_TYPES = new Set(["fence", "code_block", "hr", "html_block"]);

export interface BlockRange {
  /** 0-indexed, inclusive first line of the block. */
  start: number;
  /** 0-indexed, exclusive line just past the block's last line. */
  end: number;
}

/**
 * topLevelBlockRanges tokenizes `markdownBody` and returns the line range of
 * every top-level (level === 0) block, in document order. Nested constructs
 * (list items, table rows, blockquote paragraphs, ...) are intentionally
 * excluded — the gutter marks whole lists/blockquotes/tables as one block,
 * matching how a single ProseMirror top-level node renders them.
 */
export function topLevelBlockRanges(markdownBody: string): BlockRange[] {
  const tokens = md.parse(markdownBody, {});
  const ranges: BlockRange[] = [];
  for (const token of tokens) {
    if (token.level !== 0 || !token.map) continue;
    if (BLOCK_OPEN_TYPES.has(token.type) || BLOCK_STANDALONE_TYPES.has(token.type)) {
      ranges.push({ start: token.map[0], end: token.map[1] });
    }
  }
  return ranges;
}

function findBlockIndex(ranges: BlockRange[], lineIndex: number): number | null {
  for (let i = 0; i < ranges.length; i++) {
    if (lineIndex >= ranges[i].start && lineIndex < ranges[i].end) return i;
  }
  return null;
}

export type GutterMarkKind = "add" | "mod";

export interface GutterMark {
  /** Index into the current text's topLevelBlockRanges()/doc.childCount. */
  blockIndex: number;
  /**
   * "add" when every line of the block is new, "mod" when only some of it
   * changed. Omitted when the block itself is unchanged but is marked purely
   * for `delAbove` (content was deleted immediately before it).
   */
  kind?: GutterMarkKind;
  /** A deletion run's next surviving line falls in this block — short red
   *  marker rendered at the top of the block (VSCode's "line removed above"
   *  indicator). */
  delAbove?: boolean;
}

export interface DiffGutterResult {
  marks: GutterMark[];
  /** Number of top-level blocks in `currentBody` — used by the DiffGutter
   *  extension as a safety check against the live doc's childCount. */
  blockCount: number;
}

/**
 * computeDiffGutterMarks diffs `baselineBody` (the most recent revision) and
 * `currentBody` (the live editor content) line-by-line, then attributes each
 * changed line to the top-level block it falls in (computed from
 * `currentBody`). A block is "add" when every one of its lines is new, "mod"
 * when only part of it changed. Deleted lines carry no position of their own
 * in the new text, so each contiguous run of deletions is attributed to the
 * block immediately following it (or the last block, if the deletion is at
 * end of file) via `delAbove`.
 */
export function computeDiffGutterMarks(
  baselineBody: string,
  currentBody: string
): DiffGutterResult {
  const ranges = topLevelBlockRanges(currentBody);
  const blockCount = ranges.length;
  if (blockCount === 0) return { marks: [], blockCount };

  const rows = lineDiff(baselineBody, currentBody);

  const marksByBlock = new Map<number, GutterMark>();
  const markFor = (blockIndex: number): GutterMark => {
    const existing = marksByBlock.get(blockIndex);
    if (existing) return existing;
    const created: GutterMark = { blockIndex };
    marksByBlock.set(blockIndex, created);
    return created;
  };

  // Added lines: tally how many of each block's lines were added, so a block
  // that is entirely new (added count === block's total line count) can be
  // told apart from one that was only partially edited.
  const addedLineCountByBlock = new Map<number, number>();
  for (const row of rows) {
    if (row.type !== "add" || row.newLine === null) continue;
    const blockIndex = findBlockIndex(ranges, row.newLine - 1);
    if (blockIndex === null) continue;
    addedLineCountByBlock.set(
      blockIndex,
      (addedLineCountByBlock.get(blockIndex) ?? 0) + 1
    );
  }
  for (const [blockIndex, addedCount] of addedLineCountByBlock) {
    const total = ranges[blockIndex].end - ranges[blockIndex].start;
    markFor(blockIndex).kind = addedCount >= total ? "add" : "mod";
  }

  // Deleted lines: attribute each contiguous del run to the block containing
  // the next row that still has a new-side line number (i.e. the block that
  // now sits where the deleted content used to be). A run with nothing after
  // it (trailing deletion) attaches to the last block. Also remember the run
  // size so the UX post-pass below can collapse pure in-place rewrites.
  const delRunSizeByBlock = new Map<number, number>();
  let i = 0;
  while (i < rows.length) {
    if (rows[i].type !== "del") {
      i++;
      continue;
    }
    let end = i;
    while (end < rows.length && rows[end].type === "del") end++;

    let targetBlockIndex: number | null = null;
    for (let j = end; j < rows.length; j++) {
      const newLine = rows[j].newLine;
      if (newLine !== null) {
        targetBlockIndex = findBlockIndex(ranges, newLine - 1);
        break;
      }
    }
    if (targetBlockIndex === null) targetBlockIndex = blockCount - 1;
    markFor(targetBlockIndex).delAbove = true;
    delRunSizeByBlock.set(
      targetBlockIndex,
      (delRunSizeByBlock.get(targetBlockIndex) ?? 0) + (end - i)
    );

    i = end;
  }

  // UX post-pass: line-level lineDiff represents an edited line as a del + add
  // pair, which we naïvely tag as "add + delAbove". Visually one "mod" bar is
  // clearer than two adjacent markers, so:
  //   - When both add and del land in the same block, demote kind "add" to
  //     "mod" (the block wasn't wholly new, it was rewritten).
  //   - When the del run's size equals the block's added-line count, treat it
  //     as a pure in-place rewrite and drop delAbove entirely.
  for (const mark of marksByBlock.values()) {
    if (!mark.delAbove) continue;
    const addCount = addedLineCountByBlock.get(mark.blockIndex) ?? 0;
    if (addCount === 0) continue;
    if (mark.kind === "add") mark.kind = "mod";
    const delCount = delRunSizeByBlock.get(mark.blockIndex) ?? 0;
    if (delCount === addCount) delete mark.delAbove;
  }

  const marks = Array.from(marksByBlock.values()).sort(
    (a, b) => a.blockIndex - b.blockIndex
  );
  return { marks, blockCount };
}
