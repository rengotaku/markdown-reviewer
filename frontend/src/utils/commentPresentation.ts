/** Presentation helpers shared by the comment list and the editor popovers. */

/** Comments are written by an AI and by people, alternating. The marker is the
 *  "ai" author (mr CLI default; see cmd/mr/inbox.go). */
export const AI_AUTHOR = "ai";

export const isAiAuthored = (author?: string): boolean => author === AI_AUTHOR;

/** The text standing in for an avatar: "AI" for the AI and "R" (reviewer)
 *  for anyone else. #364: mr is used by one person, so telling reviewers apart
 *  by name isn't worth the width; the name is on the badge's hover instead. */
export function authorInitials(author?: string): string {
  const name = (author ?? "").trim();
  if (!name) return "?";
  return isAiAuthored(name) ? "AI" : "R";
}

/** #364: the one colour that stands for an author, shared by the avatar badge
 *  and the stripe on that author's thread entries: red for the AI, blue for
 *  the reviewer (MUI palette keys). */
export function authorColor(author?: string): "error.main" | "primary.main" {
  return isAiAuthored(author) ? "error.main" : "primary.main";
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
