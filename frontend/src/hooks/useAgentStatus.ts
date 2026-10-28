import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchAgentStatus, type AgentStatusResponse, type CommentJSON } from "@/api";
import {
  applySent,
  applyStatus,
  emptyTracking,
  newAiReplies,
  type AgentTracking,
} from "@/utils/agentActivity";

/** How often the recipient's state is polled while the tab is visible. The
 *  server reads small session files and runs `ps` per session, so a few
 *  seconds is cheap and still feels live. */
export const AGENT_STATUS_POLL_MS = 3_000;

export interface AgentActivity {
  /** null until the first answer (or when the server can't be asked). */
  status: AgentStatusResponse | null;
  busySince: number | null;
  /** The current busy period was started by this editor's send button. */
  sentByUs: boolean;
  /** New AI replies per comment id since the last busy period began. */
  newReplies: ReadonlyMap<string, number>;
  /** Open comment ids at this editor's last send; null before the first. */
  sentIds: ReadonlySet<string> | null;
  /** `sentIds`: the open comments fixed just before the request went out. */
  markSent: (sentIds: ReadonlySet<string>) => void;
  /** The reader has seen the new replies; stop marking them. */
  acknowledge: () => void;
}

/** Tracks whether the AI session a send would reach is idle or still replying
 *  for the active file (#360), and which replies arrived since it started. */
export function useAgentStatus(
  path: string | undefined,
  root: string | undefined,
  comments: ReadonlyArray<CommentJSON>,
  /** False while the active file's comments are still loading. A busy period
   *  that began then would take an empty reply baseline and miss every reply,
   *  so polling waits until the list is in. */
  commentsReady: boolean
): AgentActivity {
  const key = path ? `${root ?? ""}:${path}` : "";
  const [tracking, setTracking] = useState<AgentTracking>(() => emptyTracking(key));
  // The poll callback reads the latest comments without restarting the timer
  // on every comment refetch.
  const commentsRef = useRef(comments);
  useEffect(() => {
    commentsRef.current = comments;
  }, [comments]);

  useEffect(() => {
    if (!path || !commentsReady) return;
    let cancelled = false;
    let inFlight = false;
    const poll = async () => {
      if (inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      let next: AgentStatusResponse | null = null;
      try {
        next = await fetchAgentStatus(path, root);
      } catch {
        // Unknown rather than "none": an unreachable server says nothing
        // about the session, so the indicator is hidden instead of claiming
        // that no AI is connected.
        next = null;
      } finally {
        inFlight = false;
      }
      if (cancelled) return;
      setTracking((prev) =>
        applyStatus(prev, key, next, commentsRef.current, Date.now())
      );
    };
    void poll();
    const handle = window.setInterval(() => void poll(), AGENT_STATUS_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [path, root, key, commentsReady]);

  const current = tracking.key === key ? tracking : emptyTracking(key);
  const baseline = current.baseline;
  const newReplies = useMemo(
    () => newAiReplies(baseline, comments),
    [baseline, comments]
  );

  const markSent = useCallback(
    (sentIds: ReadonlySet<string>) => {
      setTracking((prev) =>
        applySent(prev, key, commentsRef.current, Date.now(), sentIds)
      );
    },
    [key]
  );
  const acknowledge = useCallback(() => {
    setTracking((prev) =>
      prev.key === key && prev.baseline ? { ...prev, baseline: null } : prev
    );
  }, [key]);

  return {
    status: current.status,
    busySince: current.busySince,
    sentByUs: current.sentByUs,
    newReplies,
    sentIds: current.sentIds,
    markSent,
    acknowledge,
  };
}
