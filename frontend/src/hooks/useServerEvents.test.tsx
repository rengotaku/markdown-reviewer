import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useServerEvents } from "./useServerEvents";

/**
 * Minimal EventSource stand-in: jsdom has no native implementation. Tests
 * grab the most recently constructed instance via `instances` and drive it
 * manually (open/message/error) instead of a real network connection.
 */
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: MessageEvent<string>) => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  emitOpen() {
    this.onopen?.();
  }

  emitMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent<string>);
  }

  emitError() {
    this.onerror?.();
  }

  close() {
    this.closed = true;
  }
}

/**
 * jsdom reports `visibilityState: "visible"` and has no way to change it, so
 * tests override the getter directly and dispatch the event the browser would.
 */
function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("useServerEvents", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
  });

  it("connects to /api/events and reports connected=true on open", async () => {
    const { result } = renderHook(() => useServerEvents({}));
    expect(result.current.connected).toBe(false);

    const instance = MockEventSource.instances[0];
    expect(instance.url).toContain("/api/events");

    act(() => instance.emitOpen());
    await waitFor(() => expect(result.current.connected).toBe(true));
  });

  it("dispatches a tree event to onTree", async () => {
    const onTree = vi.fn();
    renderHook(() => useServerEvents({ onTree }));
    const instance = MockEventSource.instances[0];

    act(() => {
      instance.emitOpen();
      instance.emitMessage({ kind: "tree", root: "works", path: "a.md", mtime: "2026-05-20T00:00:00Z" });
    });

    await waitFor(() =>
      expect(onTree).toHaveBeenCalledWith({
        kind: "tree",
        root: "works",
        path: "a.md",
        mtime: "2026-05-20T00:00:00Z",
      })
    );
  });

  it("dispatches a file event to onFile", async () => {
    const onFile = vi.fn();
    renderHook(() => useServerEvents({ onFile }));
    const instance = MockEventSource.instances[0];

    act(() => instance.emitMessage({ kind: "file", root: "works", path: "b.md" }));

    await waitFor(() =>
      expect(onFile).toHaveBeenCalledWith({ kind: "file", root: "works", path: "b.md" })
    );
  });

  it("dispatches a comments event to onComments", async () => {
    const onComments = vi.fn();
    renderHook(() => useServerEvents({ onComments }));
    const instance = MockEventSource.instances[0];

    act(() => instance.emitMessage({ kind: "comments", root: "works", path: "c.md" }));

    await waitFor(() =>
      expect(onComments).toHaveBeenCalledWith({ kind: "comments", root: "works", path: "c.md" })
    );
  });

  it("sets connected=false on error (so callers fall back to polling)", async () => {
    const { result } = renderHook(() => useServerEvents({}));
    const instance = MockEventSource.instances[0];

    act(() => instance.emitOpen());
    await waitFor(() => expect(result.current.connected).toBe(true));

    act(() => instance.emitError());
    await waitFor(() => expect(result.current.connected).toBe(false));
  });

  it("recovers connected=true after a later reconnect (EventSource auto-retries)", async () => {
    const { result } = renderHook(() => useServerEvents({}));
    const instance = MockEventSource.instances[0];

    act(() => instance.emitOpen());
    await waitFor(() => expect(result.current.connected).toBe(true));

    act(() => instance.emitError());
    await waitFor(() => expect(result.current.connected).toBe(false));

    // The browser's EventSource reconnects using the same instance and
    // fires onopen again once the connection is re-established.
    act(() => instance.emitOpen());
    await waitFor(() => expect(result.current.connected).toBe(true));
  });

  it("ignores malformed JSON payloads without throwing", async () => {
    const onTree = vi.fn();
    renderHook(() => useServerEvents({ onTree }));
    const instance = MockEventSource.instances[0];

    expect(() => {
      act(() => instance.onmessage?.({ data: "not json" } as MessageEvent<string>));
    }).not.toThrow();
    expect(onTree).not.toHaveBeenCalled();
  });

  it("closes the EventSource and resets connected on unmount", async () => {
    const { result, unmount } = renderHook(() => useServerEvents({}));
    const instance = MockEventSource.instances[0];

    act(() => instance.emitOpen());
    await waitFor(() => expect(result.current.connected).toBe(true));

    unmount();
    expect(instance.closed).toBe(true);
  });

  it("does not throw and stays disconnected when EventSource is unavailable", () => {
    vi.stubGlobal("EventSource", undefined);
    const { result } = renderHook(() => useServerEvents({}));
    expect(result.current.connected).toBe(false);
  });

  // #183: an SSE stream holds one of the browser's 6 per-origin HTTP/1.1
  // connections for as long as the tab lives. Background tabs must give
  // theirs back or the sidebar's /api/dirs requests never get a slot.
  describe("visibility", () => {
    it("closes the stream and reports disconnected while the tab is hidden", async () => {
      const { result } = renderHook(() => useServerEvents({}));
      const instance = MockEventSource.instances[0];
      act(() => instance.emitOpen());
      await waitFor(() => expect(result.current.connected).toBe(true));

      act(() => setVisibility("hidden"));

      expect(instance.closed).toBe(true);
      await waitFor(() => expect(result.current.connected).toBe(false));
      // No replacement stream while hidden — that would defeat the point.
      expect(MockEventSource.instances).toHaveLength(1);
    });

    it("re-opens a new stream when the tab becomes visible again", async () => {
      const { result } = renderHook(() => useServerEvents({}));
      act(() => MockEventSource.instances[0].emitOpen());
      await waitFor(() => expect(result.current.connected).toBe(true));

      act(() => setVisibility("hidden"));
      act(() => setVisibility("visible"));

      expect(MockEventSource.instances).toHaveLength(2);
      const reopened = MockEventSource.instances[1];
      expect(reopened.closed).toBe(false);
      act(() => reopened.emitOpen());
      await waitFor(() => expect(result.current.connected).toBe(true));
    });

    it("dispatches events from the re-opened stream", async () => {
      const onTree = vi.fn();
      renderHook(() => useServerEvents({ onTree }));

      act(() => setVisibility("hidden"));
      act(() => setVisibility("visible"));

      act(() =>
        MockEventSource.instances[1].emitMessage({
          kind: "tree",
          root: "works",
          path: "after-resume.md",
        })
      );

      await waitFor(() =>
        expect(onTree).toHaveBeenCalledWith({
          kind: "tree",
          root: "works",
          path: "after-resume.md",
        })
      );
    });

    it("calls onResume when re-opening after hidden, but not on first connect", () => {
      const onResume = vi.fn();
      renderHook(() => useServerEvents({ onResume }));
      expect(onResume).not.toHaveBeenCalled();

      act(() => setVisibility("hidden"));
      expect(onResume).not.toHaveBeenCalled();

      act(() => setVisibility("visible"));
      expect(onResume).toHaveBeenCalledTimes(1);
    });

    it("does not call onResume for EventSource's own reconnects", async () => {
      const onResume = vi.fn();
      const { result } = renderHook(() => useServerEvents({ onResume }));
      const instance = MockEventSource.instances[0];

      act(() => instance.emitOpen());
      act(() => instance.emitError());
      await waitFor(() => expect(result.current.connected).toBe(false));
      act(() => instance.emitOpen());
      await waitFor(() => expect(result.current.connected).toBe(true));

      expect(onResume).not.toHaveBeenCalled();
    });

    it("stays closed when mounted hidden, and resumes on first show", () => {
      const onResume = vi.fn();
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });

      renderHook(() => useServerEvents({ onResume }));
      expect(MockEventSource.instances).toHaveLength(0);

      act(() => setVisibility("visible"));

      expect(MockEventSource.instances).toHaveLength(1);
      // The caller's initial load ran at mount; anything that changed before
      // the tab was first shown is a gap just like a mid-session drop.
      expect(onResume).toHaveBeenCalledTimes(1);
    });

    // `suspended` is what lets poll fallbacks tell "the stream broke" apart
    // from "we hung up on purpose" — useFileWatcher has no visibility check
    // of its own, so without it a hidden tab starts a 5s /api/stat poll.
    it("reports suspended only while hidden", async () => {
      const { result } = renderHook(() => useServerEvents({}));
      act(() => MockEventSource.instances[0].emitOpen());
      await waitFor(() => expect(result.current.connected).toBe(true));
      expect(result.current.suspended).toBe(false);

      act(() => setVisibility("hidden"));
      await waitFor(() => expect(result.current.suspended).toBe(true));
      expect(result.current.connected).toBe(false);

      act(() => setVisibility("visible"));
      await waitFor(() => expect(result.current.suspended).toBe(false));
    });

    it("does not report suspended for a plain connection drop", async () => {
      const { result } = renderHook(() => useServerEvents({}));
      const instance = MockEventSource.instances[0];

      act(() => instance.emitOpen());
      await waitFor(() => expect(result.current.connected).toBe(true));
      act(() => instance.emitError());
      await waitFor(() => expect(result.current.connected).toBe(false));

      // Still visible, so the polling fallback must actually run.
      expect(result.current.suspended).toBe(false);
    });

    it("reports suspended when mounted hidden", () => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      const { result } = renderHook(() => useServerEvents({}));
      expect(result.current.suspended).toBe(true);
      expect(result.current.connected).toBe(false);
    });

    it("stops reacting to visibility changes after unmount", () => {
      const { unmount } = renderHook(() => useServerEvents({}));
      expect(MockEventSource.instances).toHaveLength(1);

      unmount();
      act(() => setVisibility("hidden"));
      act(() => setVisibility("visible"));

      expect(MockEventSource.instances).toHaveLength(1);
    });
  });
});
