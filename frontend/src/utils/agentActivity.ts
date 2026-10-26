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
  /** Reply count per comment when the last busy period began. Replies past
   *  these counts are new. Null once the reader has acknowledged them. */
  baseline: ReadonlyMap<string, number> | null;
}

export const emptyTracking = (key: string): AgentTracking => ({
  key,
  status: null,
  busySince: null,
  sentByUs: false,
  baseline: null,
});

export function replyCounts(comments: ReadonlyArray<CommentJSON>): Map<string, number> {
  return new Map(comments.map((c) => [c.id, c.replies?.length ?? 0]));
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
    const added = (c.replies ?? []).slice(before).filter((r) => isAiAuthored(r.author)).length;
    if (added > 0) out.set(c.id, added);
  }
  return out;
}

const sameStatus = (a: AgentStatusResponse | null, b: AgentStatusResponse | null) =>
  a?.state === b?.state && a?.session_name === b?.session_name && a?.agent_id === b?.agent_id;

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
  const wasBusy = base.busySince !== null;
  const nowBusy = next?.state === "busy";
  if (wasBusy && !nowBusy && base.sentByUs && now - base.busySince! < SEND_GRACE_MS) {
    return base;
  }
  if (nowBusy && !wasBusy) {
    return { ...base, status: next, busySince: now, sentByUs: false, baseline: replyCounts(comments) };
  }
  if (!nowBusy && wasBusy) {
    return { ...base, status: next, busySince: null, sentByUs: false };
  }
  return sameStatus(base.status, next) && base === prev ? prev : { ...base, status: next };
}

/** The send button delivered the command: show "replying" right away. */
export function applySent(
  prev: AgentTracking,
  key: string,
  comments: ReadonlyArray<CommentJSON>,
  now: number
): AgentTracking {
  const base = prev.key === key ? prev : emptyTracking(key);
  const status: AgentStatusResponse = { ...(base.status ?? {}), state: "busy" };
  return { ...base, status, busySince: now, sentByUs: true, baseline: replyCounts(comments) };
}

/** Display name for an adapter id ("claude" → "Claude"). */
export function agentLabel(agentId?: string): string {
  if (!agentId) return "AI";
  return agentId.charAt(0).toUpperCase() + agentId.slice(1);
}
