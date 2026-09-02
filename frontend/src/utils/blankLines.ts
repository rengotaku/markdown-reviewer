import { topLevelBlockRanges } from "@/utils/diffGutterMarks";

// blankLines carries the number of *extra* blank lines around each
// top-level Markdown block, so the editor can render them (#259) and the
// serializer can restore them on save.
//
// tiptap-markdown's writer always separates top-level blocks with exactly
// one blank line (`\n\n`), so a source file with 1 blank line and one with 5
// blank lines render identically once loaded — and saving always collapses
// back to 1. We recover the original count from markdown-it's block
// `.map` ranges (the same source diffGutterMarks/lineNumbers already use)
// before the doc is built, then store the "extra" (beyond the normal single
// blank line) per block so the ProseMirror doc can carry it as an attribute.

export interface BlankLinePayload {
  /**
   * Extra blank lines (beyond the normal single-blank-line separator)
   * before each top-level block, in doc order. `extras[0]` is the number of
   * blank lines at the very start of the document (there's no "normal"
   * separator to subtract there).
   */
  extras: number[];
  /** Number of top-level blocks markdown-it saw — cross-checked against the
   *  live doc's childCount before the payload is trusted (mirrors
   *  DiffGutter/LineNumberGutter's safety check). */
  blockCount: number;
}

/**
 * markdown-it's list tokens (bullet_list/ordered_list) swallow trailing
 * blank lines into their own `.map` end — e.g. `- a\n- b\n\n\n\nNext.`
 * reports the list's range as covering the blank lines too, rather than
 * ending right after `- b`. Left uncorrected, those blank lines would be
 * invisible to computeBlankLines (they'd never appear as a gap between two
 * ranges). Trim them back to the block's true last non-blank line before
 * measuring gaps. Verified empirically: headings/paragraphs/fences/tables/
 * blockquotes don't exhibit this and are unaffected by the trim (their map
 * already ends right after their last content line).
 */
function trueEndLine(lines: string[], range: { start: number; end: number }): number {
  for (let line = range.end - 1; line >= range.start; line--) {
    if (lines[line]?.trim() !== "") return line + 1;
  }
  return range.end;
}

/**
 * computeBlankLines tokenizes `body` and reports, for every top-level block,
 * how many blank lines separate it from the previous block beyond the
 * single blank line tiptap-markdown always writes back out.
 */
export function computeBlankLines(body: string): BlankLinePayload {
  const ranges = topLevelBlockRanges(body);
  if (ranges.length === 0) return { extras: [], blockCount: 0 };

  const lines = body.split("\n");
  const trueEnds = ranges.map((range) => trueEndLine(lines, range));

  const extras = ranges.map((range, index) => {
    if (index === 0) return range.start;
    return Math.max(0, range.start - trueEnds[index - 1] - 1);
  });

  return { extras, blockCount: ranges.length };
}
