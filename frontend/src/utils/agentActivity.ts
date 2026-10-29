import type { AgentStatusResponse, CommentJSON } from "@/api";
import { isAiAuthored } from "./commentPresentation";

/** After a send, the session can still report idle for a moment before it
 *  picks the command up. Within this window an idle answer does not end the
 *  "replying" state, so the indicator doesn't flicker back to idle. */
export const SEND_GRACE_MS = 5_000;

/** What the editor tracks about the AI session for one file. */
export interface AgentTracking {
  /** `${root}:${path}` the tracking belongs to; anything else is stale. */
  key: string;
  status: AgentStatusResponse | null;
  /** When the current busy period began (ms epoch); null while not busy. */
  busySince: number | null;
  /** The current busy period was started by this editor's send button. */
  sentByUs: boolean;
  /** AI reply count per comment when the last busy period began; anything
   *  above it is new. Null once the reader has acknowledged them. */
  baseline: ReadonlyMap<string, number> | null;
  /** Open comment ids at the last send from this editor (#366): the AI reads
   *  these and only these. Null until this editor has sent for the file. */
  sentIds: ReadonlySet<string> | null;
}

export const emptyTracking = (key: string): AgentTracking => ({
  key,
  status: null,
  busySince: null,
  sentByUs: false,
  baseline: null,
  sentIds: null,
});

const aiReplyCount = (c: CommentJSON) =>
  (c.replies ?? []).filter((r) => isAiAuthored(r.author)).length;

/** AI replies only: they are read-only to the reviewer, so unlike the reader's
 *  own replies they never disappear and the count only grows. */
export function replyCounts(comments: ReadonlyArray<CommentJSON>): Map<string, number> {
  return new Map(comments.map((c) => [c.id, aiReplyCount(c)]));
}

/** Comments the AI still has to see: a send hands over every open comment, so
 *  each one is either in the last send or written after it. */
export function openCommentIds(comments: ReadonlyArray<CommentJSON>): Set<string> {
  return new Set(comments.filter((c) => c.status !== "resolved").map((c) => c.id));
}

/** The thread ends with the reader, so a reply from the AI is still due (#372).
 *  One whose last word is the AI's — answered during this send or before it —
 *  has nothing left for the AI to write. */
export function awaitsAiReply(c: CommentJSON): boolean {
  const replies = c.replies ?? [];
  const last = replies.length > 0 ? replies[replies.length - 1].author : c.author;
  return !isAiAuthored(last);
}

/** Open comments written after the last send. Null when this editor hasn't
 *  sent for the file yet, so nothing is known about what the AI has read. */
export function unsentCount(
  sentIds: ReadonlySet<string> | null,
  comments: ReadonlyArray<CommentJSON>
): number | null {
  if (!sentIds) return null;
  return comments.filter((c) => c.status !== "resolved" && !sentIds.has(c.id)).length;
}

/** AI replies added since `baseline`, per comment id. Comments that did not
 *  exist at the baseline are skipped: the AI answers comments, it doesn't
 *  write them, so a new comment is the reader's own. */
export function newAiReplies(
  baseline: ReadonlyMap<string, number> | null,
  comments: ReadonlyArray<CommentJSON>
): Map<string, number> {
  const out = new Map<string, number>();
  if (!baseline) return out;
  for (const c of comments) {
    const before = baseline.get(c.id);
    if (before === undefined) continue;
    const added = aiReplyCount(c) - before;
    if (added > 0) out.set(c.id, added);
  }
  return out;
}

const sameStatus = (a: AgentStatusResponse | null, b: AgentStatusResponse | null) =>
  a?.state === b?.state &&
  a?.session_name === b?.session_name &&
  a?.agent_id === b?.agent_id;

/** Folds one polled status into the tracking. Returns `prev` itself when
 *  nothing visible changed, so a steady state doesn't re-render the editor. */
export function applyStatus(
  prev: AgentTracking,
  key: string,
  next: AgentStatusResponse | null,
  comments: ReadonlyArray<CommentJSON>,
  now: number
): AgentTracking {
  const base = prev.key === key ? prev : emptyTracking(key);
  // A failed poll says nothing about the session: hide the state but keep the
  // busy period and baseline, so a reply that lands meanwhile still counts.
  if (next === null)
    return base.status === null && base === prev ? prev : { ...base, status: null };
  const wasBusy = base.busySince !== null;
  const nowBusy = next?.state === "busy";
  if (wasBusy && !nowBusy && base.sentByUs && now - base.busySince! < SEND_GRACE_MS) {
    return base;
  }
  if (nowBusy && !wasBusy) {
    return {
      ...base,
      status: next,
      busySince: now,
      sentByUs: false,
      baseline: replyCounts(comments),
    };
  }
  if (!nowBusy && wasBusy) {
    return { ...base, status: next, busySince: null, sentByUs: false };
  }
  return sameStatus(base.status, next) && base === prev
    ? prev
    : { ...base, status: next };
}

/** The send button delivered the command: show "replying" right away. */
export function applySent(
  prev: AgentTracking,
  key: string,
  comments: ReadonlyArray<CommentJSON>,
  now: number,
  /** Open comments fixed before the request; defaults to those in `comments`. */
  sentIds: ReadonlySet<string> = openCommentIds(comments)
): AgentTracking {
  // The send resolves after a network round trip. If another file is active
  // by then, this send no longer describes what is on screen.
  if (prev.key !== key) return prev;
  const status: AgentStatusResponse = { ...(prev.status ?? {}), state: "busy" };
  return {
    ...prev,
    status,
    busySince: now,
    sentByUs: true,
    baseline: replyCounts(comments),
    sentIds,
  };
}

/** Display name for an adapter id ("claude" → "Claude"). */
export function agentLabel(agentId?: string): string {
  if (!agentId) return "AI";
  return agentId.charAt(0).toUpperCase() + agentId.slice(1);
}
