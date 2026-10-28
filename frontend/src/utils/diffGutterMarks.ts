import MarkdownIt from "markdown-it";
import { lineDiff } from "@/utils/lineDiff";

// diffGutterMarks computes which top-level Markdown blocks (headings,
// paragraphs, ...), list items and table rows (#368) differ from a baseline
// revision, so the editor can paint a VSCode-git-gutter-style colored bar in
// the left margin (#121).
//
// Block boundaries come from markdown-it's tokenizer rather than the
// ProseMirror doc directly: it's cheap to run on plain text and gives us
// 0-indexed [start, end) line ranges we can intersect with lineDiff's
// line-level diff. The caller (DiffGutter extension) cross-checks the
// resulting blockCount against the units it finds in the live doc before
// trusting the block indices, since the two parsers can in principle diverge.

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
  /** markdown-it token that opened the block (`heading_open`, `fence`, ...). */
  type: string;
  /** 0-indexed, inclusive first line of the block. */
  start: number;
  /** 0-indexed, exclusive line just past the block's last line. */
  end: number;
}

/**
 * topLevelBlockRanges tokenizes `markdownBody` and returns the line range of
 * every top-level (level === 0) block, in document order. Nested constructs
 * (list items, table rows, blockquote paragraphs, ...) are excluded, matching
 * the ProseMirror doc's top-level children. The gutters split lists and
 * tables further — see gutterUnitRanges.
 */
export function topLevelBlockRanges(markdownBody: string): BlockRange[] {
  const tokens = md.parse(markdownBody, {});
  const ranges: BlockRange[] = [];
  for (const token of tokens) {
    if (token.level !== 0 || !token.map) continue;
    if (BLOCK_OPEN_TYPES.has(token.type) || BLOCK_STANDALONE_TYPES.has(token.type)) {
      ranges.push({ type: token.type, start: token.map[0], end: token.map[1] });
    }
  }
  return ranges;
}

/** Whether `markdownBody` defines any link reference (`[ref]: url`),
 *  including one nested inside a blockquote or list. */
export function hasLinkReferenceDefinitions(markdownBody: string): boolean {
  const env: { references?: Record<string, unknown> } = {};
  md.parse(markdownBody, env);
  return Object.keys(env.references ?? {}).length > 0;
}

/**
 * gutterUnitRanges returns the line range of every unit the gutters (line
 * numbers, diff marks) label, in document order (#368). A unit is a
 * top-level block, except that lists and tables are split further:
 *
 * - a list contributes one unit per item, and an item's directly nested
 *   lists contribute their own items right after it (so a nested item's
 *   range sits inside its parent's);
 * - a table contributes one unit per row. The header row's range also
 *   covers the delimiter row (`|---|`), which has no row of its own on
 *   screen.
 *
 * Lists inside a blockquote stay part of the blockquote, matching
 * blockAlignment.ts's walk of the ProseMirror doc — the two must produce the
 * same units in the same order.
 */
export function gutterUnitRanges(markdownBody: string): BlockRange[] {
  return gutterUnits(markdownBody).ranges;
}

export interface GutterUnits {
  /** Every unit, in document order (see gutterUnitRanges). */
  ranges: BlockRange[];
  /** How many of `ranges` each top-level block contributed, in order. The
   *  editor uses it to fall back to labelling a block as a whole when it
   *  splits that block differently (blockAlignment.ts's alignUnits). */
  groupSizes: number[];
}

export function gutterUnits(markdownBody: string): GutterUnits {
  const tokens = md.parse(markdownBody, {});
  const lines = markdownBody.split("\n");
  const ranges: BlockRange[] = [];
  const groupSizes: number[] = [];
  tokens.forEach((token, index) => {
    if (token.level !== 0 || !token.map) return;
    const before = ranges.length;
    if (LIST_OPEN_TYPES.has(token.type)) {
      collectListItems(tokens, index, lines, ranges);
    } else if (token.type === "table_open") {
      collectTableRows(tokens, index, ranges);
    } else if (BLOCK_OPEN_TYPES.has(token.type) || BLOCK_STANDALONE_TYPES.has(token.type)) {
      ranges.push({ type: token.type, start: token.map[0], end: token.map[1] });
    }
    if (ranges.length > before) groupSizes.push(ranges.length - before);
  });
  return { ranges, groupSizes };
}

const LIST_OPEN_TYPES = new Set(["bullet_list_open", "ordered_list_open"]);
const LIST_CLOSE_TYPES = new Set(["bullet_list_close", "ordered_list_close"]);

type Tokens = ReturnType<typeof md.parse>;

function collectListItems(
  tokens: Tokens,
  openIndex: number,
  lines: string[],
  out: BlockRange[]
): void {
  const listLevel = tokens[openIndex].level;
  for (let i = openIndex + 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.level === listLevel && LIST_CLOSE_TYPES.has(token.type)) return;
    if (!token.map) continue;
    if (token.level === listLevel + 1 && token.type === "list_item_open") {
      out.push({
        type: token.type,
        start: token.map[0],
        end: withoutTrailingBlankLines(lines, token.map[0], token.map[1]),
      });
    } else if (token.level === listLevel + 2 && LIST_OPEN_TYPES.has(token.type)) {
      collectListItems(tokens, i, lines, out);
    }
  }
}

/**
 * markdown-it extends an item's range over the blank lines after it (the
 * last item of a list swallows the blank line that ends the list). Left in,
 * an item added at the end of a list reads as "mod" — its blank line is
 * unchanged — and a deletion just below an item puts the dash on that item.
 */
function withoutTrailingBlankLines(lines: string[], start: number, end: number): number {
  let trimmed = end;
  while (trimmed > start + 1 && (lines[trimmed - 1] ?? "").trim() === "") trimmed--;
  return trimmed;
}

function collectTableRows(tokens: Tokens, openIndex: number, out: BlockRange[]): void {
  const table = tokens[openIndex];
  const rows: BlockRange[] = [];
  for (let i = openIndex + 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === "table_close" && token.level === table.level) break;
    if (token.type === "tr_open" && token.map) {
      rows.push({ type: token.type, start: token.map[0], end: token.map[1] });
    }
  }
  if (rows.length > 0) {
    rows[0].end = rows.length > 1 ? rows[1].start : (table.map?.[1] ?? rows[0].end);
  }
  out.push(...rows);
}

/**
 * lineOwners maps each 0-indexed line to the index of the innermost unit
 * containing it (-1 for none). Units are in document order and a nested
 * unit always comes after the one containing it, so letting later ranges
 * overwrite earlier ones leaves each line with its innermost unit.
 */
function lineOwners(ranges: BlockRange[]): Int32Array {
  const lineCount = ranges.reduce((max, r) => Math.max(max, r.end), 0);
  const owners = new Int32Array(lineCount).fill(-1);
  ranges.forEach((r, index) => owners.fill(index, r.start, r.end));
  return owners;
}

function ownerOf(owners: Int32Array, lineIndex: number): number | null {
  const owner = lineIndex < owners.length ? owners[lineIndex] : -1;
  return owner === -1 ? null : owner;
}

export type GutterMarkKind = "add" | "mod";

export interface GutterMark {
  /** Index into the current text's gutterUnitRanges() (= blockAlignment's
   *  gutterUnits() of the live doc). */
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
  /** Number of units in `currentBody` — used by the DiffGutter extension
   *  as a safety check against the live doc. */
  blockCount: number;
  /** Units per top-level block (see GutterUnits). */
  groupSizes: number[];
}

/**
 * computeDiffGutterMarks diffs `baselineBody` (the most recent revision) and
 * `currentBody` (the live editor content) line-by-line, then attributes each
 * changed line to the top-level block it falls in (computed from
 * `currentBody`; for a nested list item, the innermost item). A block is
 * "add" when every one of its lines is new, "mod" when only part of it
 * changed or one of its lines replaced a deleted one. Deleted lines carry no
 * position of their own in the new text, so deletions not paired with an
 * added line are attributed to the block immediately following them (or the
 * last block, if the deletion is at end of file) via `delAbove`.
 */
export function computeDiffGutterMarks(
  baselineBody: string,
  currentBody: string
): DiffGutterResult {
  const { ranges, groupSizes } = gutterUnits(currentBody);
  const blockCount = ranges.length;
  if (blockCount === 0) return { marks: [], blockCount, groupSizes };
  const owners = lineOwners(ranges);

  const rows = lineDiff(baselineBody, currentBody);

  const marksByBlock = new Map<number, GutterMark>();
  const markFor = (blockIndex: number): GutterMark => {
    const existing = marksByBlock.get(blockIndex);
    if (existing) return existing;
    const created: GutterMark = { blockIndex };
    marksByBlock.set(blockIndex, created);
    return created;
  };

  // Walk the diff one hunk (maximal run of non-equal rows) at a time.
  // lineDiff writes an edited line as a del + add pair, so within a hunk the
  // first min(dels, adds) added lines are rewrites of deleted ones — they
  // make their unit "mod". Only the added lines beyond that are new, and
  // only the deletions beyond that are content that disappeared (#368:
  // rewriting two adjacent items is one hunk of 2 dels + 2 adds and must
  // read as two "mod" items, not "mod + dash" and "add").
  const rewrittenUnits = new Set<number>();
  const newLineCountByBlock = new Map<number, number>();
  let i = 0;
  while (i < rows.length) {
    if (rows[i].type === "equal") {
      i++;
      continue;
    }
    let end = i;
    while (end < rows.length && rows[end].type !== "equal") end++;
    const hunk = rows.slice(i, end);
    const delCount = hunk.filter((r) => r.type === "del").length;
    const addedUnits: (number | null)[] = hunk
      .filter((r) => r.type === "add" && r.newLine !== null)
      .map((r) => ownerOf(owners, (r.newLine as number) - 1));

    addedUnits.forEach((unit, k) => {
      if (unit === null) return;
      if (k < delCount) rewrittenUnits.add(unit);
      else newLineCountByBlock.set(unit, (newLineCountByBlock.get(unit) ?? 0) + 1);
    });

    if (delCount > addedUnits.length) {
      // The dash goes on the unit that now sits where the deleted content
      // used to be: the hunk's first added line if it has one, otherwise the
      // next line after the hunk. Lines no unit owns (blank lines between
      // blocks or after an item) are skipped so the dash lands on the next
      // unit rather than on the last one; a trailing deletion falls back to
      // the last unit.
      let target: number | null = addedUnits.find((u) => u !== null) ?? null;
      for (let j = end; target === null && j < rows.length; j++) {
        const newLine = rows[j].newLine;
        if (newLine !== null) target = ownerOf(owners, newLine - 1);
      }
      markFor(target ?? blockCount - 1).delAbove = true;
    }

    i = end;
  }

  // A unit's total is the lines it owns: a list item's nested items own
  // their own lines, so they don't count towards the parent.
  const ownedLineCountByBlock = new Map<number, number>();
  for (const owner of owners) {
    if (owner !== -1) ownedLineCountByBlock.set(owner, (ownedLineCountByBlock.get(owner) ?? 0) + 1);
  }
  for (const unit of rewrittenUnits) markFor(unit).kind = "mod";
  for (const [unit, newCount] of newLineCountByBlock) {
    if (rewrittenUnits.has(unit)) continue;
    markFor(unit).kind = newCount >= (ownedLineCountByBlock.get(unit) ?? 0) ? "add" : "mod";
  }

  const marks = Array.from(marksByBlock.values()).sort(
    (a, b) => a.blockIndex - b.blockIndex
  );
  return { marks, blockCount, groupSizes };
}
