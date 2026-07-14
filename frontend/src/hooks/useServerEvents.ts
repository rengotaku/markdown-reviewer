import { useEffect, useRef, useState } from "react";
import { API_BASE_URL } from "@/api";

/** Discriminant matching the Go side's events.Kind (internal/events/hub.go). */
export type ServerEventKind = "tree" | "file" | "comments";

/** Mirrors internal/events.Event's JSON shape (kind/root/path/mtime). */
export interface ServerEvent {
  kind: ServerEventKind;
  root: string;
  path: string;
  mtime?: string;
}

export interface UseServerEventsCallbacks {
  /** A canonical file was created/updated/deleted — refresh the file tree. */
  onTree?: (ev: ServerEvent) => void;
  /** A canonical file's content changed on disk. */
  onFile?: (ev: ServerEvent) => void;
  /** A sidecar (review.json) changed for a file. */
  onComments?: (ev: ServerEvent) => void;
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

    const source = new EventSource(`${API_BASE_URL}/api/events`);

    source.onopen = () => setConnected(true);
    // EventSource retries automatically after an error; we only need to
    // reflect the disconnected state so callers' polling fallback resumes
    // until onopen fires again.
    source.onerror = () => setConnected(false);
    source.onmessage = (e: MessageEvent<string>) => {
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

    return () => {
      source.close();
      setConnected(false);
    };
  }, []);

  return { connected };
}
