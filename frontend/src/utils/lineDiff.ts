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
