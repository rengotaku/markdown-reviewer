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

  // #178 round 3 (codex review): reverted back to round 1's original
  // behavior. Round 2 had this mark directories directly to cover the
  // collapsed-directory blind spot, but that couldn't be told apart from
  // this app's own atomic-write save also touching the same directory's
  // mtime (round 2 issue #2) — the collapsed-directory gap is now covered
  // instead by the SSE `tree` event carrying the exact file path (see
  // EditorPage's onTree handler), so directories don't need marking here.
  it("does not mark a newly appeared directory entry", async () => {
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

    // Give the subscription a tick to run — there is nothing to waitFor
    // since a directory entry must never become marked.
    await new Promise((r) => setTimeout(r, 30));
    expect(useChangedPaths.getState().isChanged("mock-root", "newdir")).toBe(false);
    expect(useChangedPaths.getState().hasChangedUnder("mock-root", "")).toBe(false);
  });

  it("marks an existing file whose mtime advances, but not a dir whose mtime advances", async () => {
    const { Wrapper, client } = makeWrapper();
    renderHook(() => useDirChangeWatcher(), { wrapper: Wrapper });

    act(() => {
      client.setQueryData(dirQueryKey("mock-root", ""), {
        entries: [
          { name: "a.md", path: "a.md", type: "file", modified: "2026-05-20T00:00:00Z" },
          { name: "sub", path: "sub", type: "dir", modified: "2026-05-20T00:00:00Z" },
        ],
      });
    });
    act(() => {
      client.setQueryData(dirQueryKey("mock-root", ""), {
        entries: [
          { name: "a.md", path: "a.md", type: "file", modified: "2026-05-22T00:00:00Z" },
          // The directory's own mtime moved (e.g. a child was added/removed)
          // but that must not mark the directory entry itself (#178 round 3
          // — see this hook's docstring for the collapsed-dir trade-off).
          { name: "sub", path: "sub", type: "dir", modified: "2026-05-22T00:00:00Z" },
        ],
      });
    });

    await waitFor(() =>
      expect(useChangedPaths.getState().isChanged("mock-root", "a.md")).toBe(true)
    );
    expect(useChangedPaths.getState().isChanged("mock-root", "sub")).toBe(false);
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

  // #178 round 3 (codex review, must-fix): a mark on a path that vanished
  // from the listing (deleted/renamed away) could never be cleared by
  // opening the file — it can't be opened anymore — so it would otherwise
  // keep an ancestor directory's dot lit forever via hasChangedUnder.
  it("clears an existing mark on a path that disappears from the listing", async () => {
    const { Wrapper, client } = makeWrapper();
    renderHook(() => useDirChangeWatcher(), { wrapper: Wrapper });

    act(() => {
      client.setQueryData(dirQueryKey("mock-root", ""), {
        entries: [
          { name: "a.md", path: "a.md", type: "file", modified: "2026-05-20T00:00:00Z" },
        ],
      });
    });

    // Something else (e.g. the SSE `tree` event) already marked it before
    // this hook's own snapshot diff observes the deletion.
    useChangedPaths.getState().mark("mock-root", "a.md");
    expect(useChangedPaths.getState().isChanged("mock-root", "a.md")).toBe(true);

    act(() => {
      client.setQueryData(dirQueryKey("mock-root", ""), { entries: [] });
    });

    await waitFor(() =>
      expect(useChangedPaths.getState().isChanged("mock-root", "a.md")).toBe(false)
    );
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

  // #178 round 4 (codex review, adopted): the de-dup signature used to omit
  // the root (`${path}@${mtime}` only), so two different roots' listings
  // reporting the same path at the same second-precision mtime collided —
  // whichever root's update this hook processed second was silently
  // dropped, leaving that root's copy unmarked.
  it("marks the same path independently across two roots hitting the same mtime", async () => {
    const { Wrapper, client } = makeWrapper();
    renderHook(() => useDirChangeWatcher(), { wrapper: Wrapper });

    act(() => {
      client.setQueryData(dirQueryKey("root-a", ""), {
        entries: [
          { name: "a.md", path: "a.md", type: "file", modified: "2026-05-20T00:00:00Z" },
        ],
      });
    });
    act(() => {
      client.setQueryData(dirQueryKey("root-b", ""), {
        entries: [
          { name: "a.md", path: "a.md", type: "file", modified: "2026-05-20T00:00:00Z" },
        ],
      });
    });

    // Both roots' a.md independently advance to the exact same new mtime.
    act(() => {
      client.setQueryData(dirQueryKey("root-a", ""), {
        entries: [
          { name: "a.md", path: "a.md", type: "file", modified: "2026-05-22T00:00:00Z" },
        ],
      });
    });
    act(() => {
      client.setQueryData(dirQueryKey("root-b", ""), {
        entries: [
          { name: "a.md", path: "a.md", type: "file", modified: "2026-05-22T00:00:00Z" },
        ],
      });
    });

    await waitFor(() =>
      expect(useChangedPaths.getState().isChanged("root-a", "a.md")).toBe(true)
    );
    await waitFor(() =>
      expect(useChangedPaths.getState().isChanged("root-b", "a.md")).toBe(true)
    );
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
