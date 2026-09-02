/** Presentation helpers shared by the comment list and the editor popovers. */

/** Comments are written by an AI and by people, alternating. The marker is the
 *  "ai" author (mr CLI default; see cmd/mr/inbox.go). */
export const AI_AUTHOR = "ai";

export const isAiAuthored = (author?: string): boolean => author === AI_AUTHOR;

/** Up to two characters standing in for an avatar. Latin names give their
 *  first letter; CJK names give the first character, which is the part a
 *  reader recognises. */
export function authorInitials(author?: string): string {
  const name = (author ?? "").trim();
  if (!name) return "?";
  if (isAiAuthored(name)) return "AI";
  return [...name][0]?.toUpperCase() ?? "?";
}

/** A stable hue per author, so the same person keeps the same badge colour
 *  across sessions without anyone configuring one. */
export function authorHue(author?: string): number {
  const name = (author ?? "").trim();
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) % 360;
  return h;
}

/**
 * "3 日前" for a comment's date. Comments carry a date, not a timestamp
 * (`todayISO()` on write), so the resolution stops at days — anything from
 * today reads as 今日 rather than being invented into hours.
 */
export function relativeDate(date: string | undefined, now = new Date()): string {
  if (!date) return "";
  const then = new Date(`${date}T00:00:00`);
  if (Number.isNaN(then.getTime())) return date;
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();
  const days = Math.round((startOfToday - then.getTime()) / 86_400_000);
  if (days <= 0) return "今日";
  if (days === 1) return "昨日";
  if (days < 7) return `${days} 日前`;
  if (days < 30) return `${Math.floor(days / 7)} 週間前`;
  if (days < 365) return `${Math.floor(days / 30)} か月前`;
  return `${Math.floor(days / 365)} 年前`;
}
