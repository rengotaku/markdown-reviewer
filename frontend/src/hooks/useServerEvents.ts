import { useEffect, useRef, useState } from "react";
import { API_BASE_URL } from "@/api";

/** Discriminant matching the Go side's events.Kind (internal/events/hub.go). */
export type ServerEventKind = "tree" | "file" | "comments";

/** Mirrors internal/events.Event's JSON shape (kind/root/path/mtime/sha). */
export interface ServerEvent {
  kind: ServerEventKind;
  root: string;
  path: string;
  mtime?: string;
  /** sha256 hex of the file's on-disk bytes (#119). Only set on kind="file". */
  sha?: string;
}

export interface UseServerEventsCallbacks {
  /** A canonical file was created/updated/deleted — refresh the file tree. */
  onTree?: (ev: ServerEvent) => void;
  /** A canonical file's content changed on disk. */
  onFile?: (ev: ServerEvent) => void;
  /** A sidecar (review.json) changed for a file. */
  onComments?: (ev: ServerEvent) => void;
  /**
   * The tab came back to the foreground and the stream is being re-opened
   * after having been dropped while hidden (#183). Events that happened in
   * that window were never delivered, so the caller must re-read whatever
   * the stream would otherwise have kept in sync (dir/file listings).
   *
   * Not called on the initial connect, and not called for EventSource's own
   * transient reconnects — only for the deliberate hidden→visible cycle,
   * which is the only case where we knowingly stopped listening.
   */
  onResume?: () => void;
}

/**
 * Subscribes to GET /api/events (SSE) and dispatches each parsed event to
 * the matching callback. Returns `connected`, which callers use to decide
 * whether to keep their own polling fallback active — degrade to polling
 * while `connected` is false (initial connect, network blip, server
 * restart) and rely on the push channel once it flips true.
 *
 * EventSource handles reconnection itself (browser built-in retry with
 * backoff), so this hook only needs to track open/error transitions, not
 * implement retry logic.
 *
 * The stream is dropped while the tab is hidden and re-opened when it comes
 * back (#183). Browsers cap HTTP/1.1 at 6 connections per origin, and an SSE
 * stream holds one for the tab's entire lifetime — so six background tabs
 * left open leave zero slots for /api/dirs and the sidebar stops loading.
 * A hidden tab renders nothing, so the stream buys it nothing either; the
 * companion polls (useDir/useFiles) already stand down while hidden via
 * `refetchIntervalInBackground: false`, and this makes the push channel
 * follow the same rule. `onResume` covers the events missed in between.
 */
export function useServerEvents(callbacks: UseServerEventsCallbacks): {
  connected: boolean;
} {
  const [connected, setConnected] = useState(false);

  // Stash the latest callbacks so the EventSource effect doesn't have to
  // tear down/reconnect every time a caller passes a fresh closure.
  const callbacksRef = useRef(callbacks);
  useEffect(() => {
    callbacksRef.current = callbacks;
  }, [callbacks]);

  useEffect(() => {
    // jsdom (and some older environments) may not implement EventSource at
    // all; degrade to "never connected" rather than throwing, so callers
    // fall back to polling automatically.
    if (typeof EventSource === "undefined") {
      return;
    }

    let source: EventSource | null = null;
    // True once we've deliberately stopped listening (tab hidden), so the
    // next open knows it has a gap to hand back to the caller via onResume.
    // Also set when we mount already-hidden: the caller's initial load ran
    // at mount, and anything that changed before the tab was first shown is
    // just as invisible to it as an event dropped mid-session.
    let missedWhileHidden = false;

    const isHidden = () => document.visibilityState === "hidden";

    const openStream = () => {
      if (source) return;

      const es = new EventSource(`${API_BASE_URL}/api/events`);
      source = es;

      es.onopen = () => setConnected(true);
      // EventSource retries automatically after an error; we only need to
      // reflect the disconnected state so callers' polling fallback resumes
      // until onopen fires again.
      es.onerror = () => setConnected(false);
      es.onmessage = (e: MessageEvent<string>) => {
        let parsed: ServerEvent;
        try {
          parsed = JSON.parse(e.data) as ServerEvent;
        } catch {
          return;
        }
        const { onTree, onFile, onComments } = callbacksRef.current;
        switch (parsed.kind) {
          case "tree":
            onTree?.(parsed);
            break;
          case "file":
            onFile?.(parsed);
            break;
          case "comments":
            onComments?.(parsed);
            break;
        }
      };

      // Fires on re-open, not on the connection actually being established:
      // the caller needs to re-read regardless of whether the stream comes
      // back up, and if it doesn't, its polling fallback is what serves the
      // refetch anyway.
      if (missedWhileHidden) {
        missedWhileHidden = false;
        callbacksRef.current.onResume?.();
      }
    };

    const closeStream = () => {
      if (!source) return;
      source.close();
      source = null;
      setConnected(false);
    };

    const handleVisibilityChange = () => {
      if (isHidden()) {
        closeStream();
        missedWhileHidden = true;
      } else {
        openStream();
      }
    };

    if (isHidden()) {
      missedWhileHidden = true;
    } else {
      openStream();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      closeStream();
    };
  }, []);

  return { connected };
}
