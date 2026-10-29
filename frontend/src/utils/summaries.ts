import type { SummaryItem } from "@/api";

/** First heading, else first non-empty line, with markdown marks removed.
 *  Fenced code lines are skipped so a reply that opens with a code block
 *  still gets a readable title. */
export function summaryTitle(text: string): string {
  let inFence = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("```") || line.startsWith("~~~")) {
      inFence = !inFence;
      continue;
    }
    if (inFence || line === "") continue;
    const plain = line
      .replace(/^#{1,6}\s+/, "")
      .replace(/^(?:[-*+]|\d+[.)])\s+/, "")
      .replace(/^>\s?/, "")
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[*_`~]/g, "")
      .trim();
    if (plain !== "") return plain;
  }
  return "";
}

/** `c-001` style ids in the text that exist in the file, in order of first
 *  appearance. */
export function referencedCommentIds(
  text: string,
  existing: ReadonlySet<string>
): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\bc-\d+\b/g)) {
    if (existing.has(m[0]) && !out.includes(m[0])) out.push(m[0]);
  }
  return out;
}

/** How many summaries are newer than the last one the reader opened.
 *  `summaries` is newest first; an unknown or missing id counts them all. */
export function unreadSummaryCount(
  summaries: ReadonlyArray<SummaryItem>,
  lastSeenId: string | null
): number {
  if (lastSeenId === null) return summaries.length;
  const at = summaries.findIndex((s) => s.id === lastSeenId);
  return at === -1 ? summaries.length : at;
}

export const summarySeenKey = (root: string | undefined, path: string) =>
  `mr:summary-seen:${root ?? ""}:${path}`;

export function readSummarySeen(root: string | undefined, path: string): string | null {
  try {
    return localStorage.getItem(summarySeenKey(root, path));
  } catch {
    return null;
  }
}

export function writeSummarySeen(
  root: string | undefined,
  path: string,
  id: string
): void {
  try {
    localStorage.setItem(summarySeenKey(root, path), id);
  } catch {
    // Storage can be unavailable (private mode, quota); unread just resets.
  }
}

const pad = (n: number) => String(n).padStart(2, "0");

export function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--";
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatSpan(sentIso: string, doneIso: string): string {
  const ms = new Date(doneIso).getTime() - new Date(sentIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const sec = Math.floor(ms / 1000);
  return `${Math.floor(sec / 60)}:${pad(sec % 60)}`;
}
