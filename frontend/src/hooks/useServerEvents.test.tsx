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

describe("useServerEvents", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
});
