// lineDiff computes a line-level diff between two texts using a longest-common-
// subsequence (LCS) backtrace. It is intentionally dependency-free (no jsdiff)
// — markdown documents are a few hundred lines at most, so the O(n·m) table is
// cheap, and avoiding a new runtime dependency keeps the supply chain lean.

export type DiffRowType = "equal" | "add" | "del";

export interface DiffRow {
  type: DiffRowType;
  /** Line content (without the trailing newline). */
  text: string;
  /** 1-indexed line number in the old text (null for added lines). */
  oldLine: number | null;
  /** 1-indexed line number in the new text (null for deleted lines). */
  newLine: number | null;
}

// splitLines splits on \n while dropping a single trailing empty line so a
// file ending in "\n" doesn't render a phantom blank diff row.
function splitLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

export function lineDiff(oldText: string, newText: string): DiffRow[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const n = a.length;
  const m = b.length;

  // lcs[i][j] = LCS length of a[i:] and b[j:].
  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0)
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ type: "equal", text: a[i], oldLine: i + 1, newLine: j + 1 });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      rows.push({ type: "del", text: a[i], oldLine: i + 1, newLine: null });
      i++;
    } else {
      rows.push({ type: "add", text: b[j], oldLine: null, newLine: j + 1 });
      j++;
    }
  }
  while (i < n) {
    rows.push({ type: "del", text: a[i], oldLine: i + 1, newLine: null });
    i++;
  }
  while (j < m) {
    rows.push({ type: "add", text: b[j], oldLine: null, newLine: j + 1 });
    j++;
  }
  return rows;
}

/** hasChanges reports whether any add/del row exists (i.e. the texts differ). */
export function hasChanges(rows: DiffRow[]): boolean {
  return rows.some((r) => r.type !== "equal");
}

/** countChanges returns the number of added and deleted lines in a diff. */
export function countChanges(rows: DiffRow[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const row of rows) {
    if (row.type === "add") added++;
    else if (row.type === "del") removed++;
  }
  return { added, removed };
}

/** A run of characters within a line, flagged as changed or unchanged. */
export interface CharSeg {
  text: string;
  changed: boolean;
}

// pushChar appends a single char to a segment list, merging with the previous
// segment when it has the same changed flag so runs render as one <span>.
function pushChar(segs: CharSeg[], ch: string, changed: boolean): void {
  const last = segs[segs.length - 1];
  if (last && last.changed === changed) last.text += ch;
  else segs.push({ text: ch, changed });
}

/**
 * charDiff computes a character-level diff between two single lines (a changed
 * line's old vs new text) via the same LCS backtrace as lineDiff. It returns
 * per-side segments so the viewer can bold only the characters that actually
 * changed, plus `ratio` (0–1, Sørensen–Dice over characters) so callers can
 * skip intra-line highlighting for pairs too dissimilar to be a real edit.
 */
export function charDiff(
  a: string,
  b: string
): { del: CharSeg[]; add: CharSeg[]; ratio: number } {
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0)
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const del: CharSeg[] = [];
  const add: CharSeg[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pushChar(del, a[i], false);
      pushChar(add, b[j], false);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      pushChar(del, a[i], true);
      i++;
    } else {
      pushChar(add, b[j], true);
      j++;
    }
  }
  while (i < n) pushChar(del, a[i++], true);
  while (j < m) pushChar(add, b[j++], true);

  const common = lcs[0][0];
  const ratio = n + m === 0 ? 1 : (2 * common) / (n + m);
  return { del, add, ratio };
}

/** Pairs are considered edits of the same line (worth an intra-line diff) only
 *  above this character-similarity ratio; below it they're treated as an
 *  unrelated delete + add and the whole line is highlighted instead. */
const INTRA_LINE_SIMILARITY_MIN = 0.3;

/**
 * intraLineSegments annotates changed lines with character-level segments.
 * It pairs each run of consecutive `del` rows with the `add` run that follows
 * it (by position), and for pairs similar enough to be a genuine edit records
 * the per-character segments keyed by row index. Rows absent from the map are
 * pure insertions/deletions (or dissimilar) and should render whole-line.
 */
export function intraLineSegments(rows: DiffRow[]): Map<number, CharSeg[]> {
  const segsByRow = new Map<number, CharSeg[]>();
  let i = 0;
  while (i < rows.length) {
    if (rows[i].type !== "del") {
      i++;
      continue;
    }
    let delEnd = i;
    while (delEnd < rows.length && rows[delEnd].type === "del") delEnd++;
    let addEnd = delEnd;
    while (addEnd < rows.length && rows[addEnd].type === "add") addEnd++;

    const pairs = Math.min(delEnd - i, addEnd - delEnd);
    for (let k = 0; k < pairs; k++) {
      const delIdx = i + k;
      const addIdx = delEnd + k;
      const { del, add, ratio } = charDiff(rows[delIdx].text, rows[addIdx].text);
      if (ratio >= INTRA_LINE_SIMILARITY_MIN) {
        segsByRow.set(delIdx, del);
        segsByRow.set(addIdx, add);
      }
    }
    i = addEnd;
  }
  return segsByRow;
}
