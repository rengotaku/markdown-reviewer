import { topLevelBlockRanges } from "@/utils/diffGutterMarks";
import type { LineNumberPayload } from "@/components/tiptap/extensions/LineNumberGutter";

/**
 * Number of lines `raw` carries before `body` starts.
 *
 * `body` is always a suffix of `raw` (stripHint and splitPreamble only cut
 * from the front), so the offset is just the newline count of what precedes
 * it. Returns 0 when that assumption doesn't hold rather than reporting line
 * numbers that are off by an unknown amount.
 */
export function preambleLineOffset(raw: string, body: string): number {
  if (!raw.endsWith(body)) return 0;
  const prefix = raw.slice(0, raw.length - body.length);
  return (prefix.match(/\n/g) ?? []).length;
}

/**
 * computeLineNumbers maps each top-level Markdown block to the 1-indexed
 * source line it starts on, for the editor's line-number gutter (#234).
 *
 * `raw` is the file as stored (hint comment + frontmatter + body) and `body`
 * is what the editor actually renders; the preamble is added back in so the
 * numbers match the file on disk, not the body-only offset.
 */
export function computeLineNumbers(raw: string, body: string): LineNumberPayload {
  const ranges = topLevelBlockRanges(body);
  if (ranges.length === 0) return { lines: [], blockCount: 0 };
  const offset = preambleLineOffset(raw, body);
  return {
    lines: ranges.map((r) => offset + r.start + 1),
    blockCount: ranges.length,
  };
}
