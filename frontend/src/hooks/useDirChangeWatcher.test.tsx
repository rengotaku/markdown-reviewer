import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode } from "react";
import { dirQueryKey } from "./useDir";
import { useToast } from "./useToast";
import { useChangedPaths } from "./useChangedPaths";
import { useDirChangeWatcher } from "./useDirChangeWatcher";

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { Wrapper, client };
}

describe("useDirChangeWatcher", () => {
  beforeEach(() => {
    useToast.setState({ toasts: [] });
    useChangedPaths.setState({ changed: new Set(), selfWrites: new Set() });
  });

  it("treats the first snapshot per dir path as a baseline (no marks)", async () => {
    const { Wrapper, client } = makeWrapper();
    renderHook(() => useDirChangeWatcher(), { wrapper: Wrapper });

    act(() => {
      client.setQueryData(dirQueryKey("mock-root", ""), {
        entries: [
          { name: "a.md", path: "a.md", type: "file", modified: "2026-05-20T00:00:00Z" },
        ],
      });
    });

    // Give the subscription a tick to run.
    await new Promise((r) => setTimeout(r, 10));
    expect(useChangedPaths.getState().isChanged("mock-root", "a.md")).toBe(false);
  });

  it("marks a newly appeared file on a subsequent snapshot", async () => {
    const { Wrapper, client } = makeWrapper();
    renderHook(() => useDirChangeWatcher(), { wrapper: Wrapper });

    act(() => {
      client.setQueryData(dirQueryKey("mock-root", ""), {
        entries: [
          { name: "a.md", path: "a.md", type: "file", modified: "2026-05-20T00:00:00Z" },
        ],
      });
    });
    act(() => {
      client.setQueryData(dirQueryKey("mock-root", ""), {
        entries: [
          { name: "a.md", path: "a.md", type: "file", modified: "2026-05-20T00:00:00Z" },
          { name: "b.md", path: "b.md", type: "file", modified: "2026-05-21T00:00:00Z" },
        ],
      });
    });

    await waitFor(() =>
      expect(useChangedPaths.getState().isChanged("mock-root", "b.md")).toBe(true)
    );
    expect(useChangedPaths.getState().isChanged("mock-root", "a.md")).toBe(false);
  });

  // #178 round 2 (codex review): a newly appeared directory entry is now
  // marked the same as a file — this test previously asserted the opposite
  // (an addition beyond the originally-specified cases; see EditorPage
  // handoff report). Directories are collapsed by default, so their own
  // `useDir` query never mounts to observe children individually — the only
  // signal available while collapsed is the directory's own mtime moving.
  it("marks a newly appeared directory entry", async () => {
    const { Wrapper, client } = makeWrapper();
    renderHook(() => useDirChangeWatcher(), { wrapper: Wrapper });

    act(() => {
      client.setQueryData(dirQueryKey("mock-root", ""), { entries: [] });
    });
    act(() => {
      client.setQueryData(dirQueryKey("mock-root", ""), {
        entries: [
          { name: "newdir", path: "newdir", type: "dir", modified: "2026-05-21T00:00:00Z" },
        ],
      });
    });

    await waitFor(() =>
      expect(useChangedPaths.getState().isChanged("mock-root", "newdir")).toBe(true)
    );
  });

  it("marks an existing file whose mtime advances", async () => {
    const { Wrapper, client } = makeWrapper();
    renderHook(() => useDirChangeWatcher(), { wrapper: Wrapper });

    act(() => {
      client.setQueryData(dirQueryKey("mock-root", ""), {
        entries: [
          { name: "a.md", path: "a.md", type: "file", modified: "2026-05-20T00:00:00Z" },
        ],
      });
    });
    act(() => {
      client.setQueryData(dirQueryKey("mock-root", ""), {
        entries: [
          { name: "a.md", path: "a.md", type: "file", modified: "2026-05-22T00:00:00Z" },
        ],
      });
    });

    await waitFor(() =>
      expect(useChangedPaths.getState().isChanged("mock-root", "a.md")).toBe(true)
    );
  });

  // #178 round 2 (codex review, must-fix): a collapsed directory's own
  // `useDir` query never mounts, so an external edit to a file inside it
  // (e.g. `docs/foo.md`) is only ever observable here as `docs`'s own mtime
  // moving. The original design skipped directory entries entirely, which
  // silently dropped this signal and the unread dot never appeared —
  // reversed here to mark the directory itself instead.
  it("marks a directory whose own mtime advances", async () => {
    const { Wrapper, client } = makeWrapper();
    renderHook(() => useDirChangeWatcher(), { wrapper: Wrapper });

    act(() => {
      client.setQueryData(dirQueryKey("mock-root", ""), {
        entries: [
          { name: "sub", path: "sub", type: "dir", modified: "2026-05-20T00:00:00Z" },
        ],
      });
    });
    act(() => {
      client.setQueryData(dirQueryKey("mock-root", ""), {
        entries: [
          // The directory's own mtime moved because a file inside it (not
          // observable while collapsed) changed.
          { name: "sub", path: "sub", type: "dir", modified: "2026-05-22T00:00:00Z" },
        ],
      });
    });

    await waitFor(() =>
      expect(useChangedPaths.getState().isChanged("mock-root", "sub")).toBe(true)
    );
  });

  it("does not mark entries that disappeared from the listing", async () => {
    const { Wrapper, client } = makeWrapper();
    renderHook(() => useDirChangeWatcher(), { wrapper: Wrapper });

    act(() => {
      client.setQueryData(dirQueryKey("mock-root", ""), {
        entries: [
          { name: "a.md", path: "a.md", type: "file", modified: "2026-05-20T00:00:00Z" },
          { name: "b.md", path: "b.md", type: "file", modified: "2026-05-20T00:00:00Z" },
        ],
      });
    });
    act(() => {
      client.setQueryData(dirQueryKey("mock-root", ""), {
        entries: [
          { name: "a.md", path: "a.md", type: "file", modified: "2026-05-20T00:00:00Z" },
        ],
      });
    });

    await new Promise((r) => setTimeout(r, 30));
    expect(useChangedPaths.getState().isChanged("mock-root", "a.md")).toBe(false);
    expect(useChangedPaths.getState().isChanged("mock-root", "b.md")).toBe(false);
  });

  it("consumes a matching self-write signature instead of marking it, and does not leave it behind", async () => {
    const { Wrapper, client } = makeWrapper();
    renderHook(() => useDirChangeWatcher(), { wrapper: Wrapper });

    useChangedPaths
      .getState()
      .registerSelfWrite("mock-root", "a.md", "2026-05-22T00:00:00Z");

    act(() => {
      client.setQueryData(dirQueryKey("mock-root", ""), {
        entries: [
          { name: "a.md", path: "a.md", type: "file", modified: "2026-05-20T00:00:00Z" },
        ],
      });
    });
    act(() => {
      client.setQueryData(dirQueryKey("mock-root", ""), {
        entries: [
          { name: "a.md", path: "a.md", type: "file", modified: "2026-05-22T00:00:00Z" },
        ],
      });
    });

    // Give the subscription a tick to run — the self-write echo must never
    // mark the file.
    await new Promise((r) => setTimeout(r, 30));
    expect(useChangedPaths.getState().isChanged("mock-root", "a.md")).toBe(false);

    // The signature must have been consumed: a later, genuinely different
    // mtime for the same path marks it as usual.
    act(() => {
      client.setQueryData(dirQueryKey("mock-root", ""), {
        entries: [
          { name: "a.md", path: "a.md", type: "file", modified: "2026-05-23T00:00:00Z" },
        ],
      });
    });
    await waitFor(() =>
      expect(useChangedPaths.getState().isChanged("mock-root", "a.md")).toBe(true)
    );
  });

  it("only marks once when the same path@mtime update is delivered twice", async () => {
    const { Wrapper, client } = makeWrapper();
    renderHook(() => useDirChangeWatcher(), { wrapper: Wrapper });

    act(() => {
      client.setQueryData(dirQueryKey("mock-root", ""), {
        entries: [
          { name: "a.md", path: "a.md", type: "file", modified: "2026-05-20T00:00:00Z" },
        ],
      });
    });
    act(() => {
      client.setQueryData(dirQueryKey("mock-root", ""), {
        entries: [
          { name: "a.md", path: "a.md", type: "file", modified: "2026-05-22T00:00:00Z" },
        ],
      });
    });
    await waitFor(() =>
      expect(useChangedPaths.getState().isChanged("mock-root", "a.md")).toBe(true)
    );

    // The user opens the file, clearing its mark...
    useChangedPaths.getState().clear("mock-root", "a.md");

    // ...and the exact same data lands again (e.g. a structural-sharing
    // no-op refetch) — it must not re-mark the already-cleared path.
    act(() => {
      client.setQueryData(dirQueryKey("mock-root", ""), {
        entries: [
          { name: "a.md", path: "a.md", type: "file", modified: "2026-05-22T00:00:00Z" },
        ],
      });
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(useChangedPaths.getState().isChanged("mock-root", "a.md")).toBe(false);
  });

  it("never shows a toast", async () => {
    const { Wrapper, client } = makeWrapper();
    const showSpy = vi.spyOn(useToast.getState(), "show");
    renderHook(() => useDirChangeWatcher(), { wrapper: Wrapper });

    act(() => {
      client.setQueryData(dirQueryKey("mock-root", ""), { entries: [] });
    });
    act(() => {
      client.setQueryData(dirQueryKey("mock-root", ""), {
        entries: [
          { name: "a.md", path: "a.md", type: "file", modified: "2026-05-20T00:00:00Z" },
          { name: "newdir", path: "newdir", type: "dir", modified: "2026-05-20T00:00:00Z" },
        ],
      });
    });

    await waitFor(() =>
      expect(useChangedPaths.getState().isChanged("mock-root", "a.md")).toBe(true)
    );
    expect(useToast.getState().toasts).toEqual([]);
    expect(showSpy).not.toHaveBeenCalled();
  });
});
