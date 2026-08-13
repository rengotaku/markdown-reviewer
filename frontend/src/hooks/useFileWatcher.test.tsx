import { describe, it, expect, beforeEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { type ReactNode } from "react";
import { server } from "@/test/mocks/server";
import { useOpenFiles } from "./useOpenFiles";
import { useConfirm } from "./useConfirm";
import { useToast } from "./useToast";
import { useChangedPaths } from "./useChangedPaths";
import { useFileWatcher } from "./useFileWatcher";

const API_BASE = "http://localhost:8080";
// Short interval so tests don't have to wait — uses real timers because
// react-testing-library's waitFor interacts poorly with vi.useFakeTimers().
const POLL_MS = 20;

const ROOT = "mock-root";

function seedActiveFile(opts: {
  name: string;
  path: string;
  markdown: string;
  serverModified: string;
  serverSha?: string;
  isDirty?: boolean;
}) {
  const id = `test-${opts.path}`;
  useOpenFiles.setState({
    files: [
      {
        id,
        name: opts.name,
        path: opts.path,
        root: ROOT,
        markdown: opts.markdown,
        savedMarkdown: opts.isDirty ? "older" : opts.markdown,
        isDirty: !!opts.isDirty,
        reloadToken: 0,
        serverSha: opts.serverSha,
        serverModified: opts.serverModified,
        serverCreated: "",
      },
    ],
    activeIdByRoot: { [ROOT]: id },
  });
  return id;
}

// useFileWatcher pulls the active root from `useActiveRoot`, which in turn
// reads from the URL (?root=) and /api/config. The watcher hook is wrapped
// in a MemoryRouter + QueryClient so those reads have somewhere to come
// from. The QueryClient pre-loads a single-root /api/config payload so
// `active` resolves to ROOT without any network round-trip.
function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["config"], {
    review_root_name: ROOT,
    review_root: `/tmp/${ROOT}`,
    review_roots: [{ name: ROOT, path: `/tmp/${ROOT}` }],
  });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("useFileWatcher", () => {
  beforeEach(() => {
    localStorage.clear();
    useOpenFiles.setState({ files: [], activeIdByRoot: {} });
    useConfirm.setState({ pending: null, queue: [] });
    useToast.setState({ toasts: [] });
    useChangedPaths.setState({ changed: new Set(), selfWrites: new Set() });
  });

  it("silently reloads the active file when external mtime is newer and buffer is clean", async () => {
    const id = seedActiveFile({
      name: "a.md",
      path: "a.md",
      markdown: "old content",
      serverModified: "2026-05-20T00:00:00Z",
    });

    server.use(
      http.get(`${API_BASE}/api/stat/a.md`, () =>
        HttpResponse.json({ path: "a.md", modified: "2026-05-21T00:00:00Z" })
      ),
      http.get(`${API_BASE}/api/files/a.md`, () =>
        HttpResponse.json({
          path: "a.md",
          content: "new content",
          modified: "2026-05-21T00:00:00Z",
        })
      )
    );

    renderHook(() => useFileWatcher(POLL_MS), { wrapper });

    await waitFor(
      () => {
        const f = useOpenFiles.getState().files.find((x) => x.id === id)!;
        expect(f.markdown).toBe("new content");
        expect(f.serverModified).toBe("2026-05-21T00:00:00Z");
        expect(f.isDirty).toBe(false);
      },
      { timeout: 2000 }
    );
  });

  it("prompts and applies external content when the user accepts on a dirty buffer", async () => {
    const id = seedActiveFile({
      name: "b.md",
      path: "b.md",
      markdown: "my edits",
      serverModified: "2026-05-20T00:00:00Z",
      isDirty: true,
    });

    server.use(
      http.get(`${API_BASE}/api/stat/b.md`, () =>
        HttpResponse.json({ path: "b.md", modified: "2026-05-21T00:00:00Z" })
      ),
      http.get(`${API_BASE}/api/files/b.md`, () =>
        HttpResponse.json({
          path: "b.md",
          content: "external content",
          modified: "2026-05-21T00:00:00Z",
        })
      )
    );

    renderHook(() => useFileWatcher(POLL_MS), { wrapper });

    await waitFor(() => expect(useConfirm.getState().pending).not.toBeNull(), {
      timeout: 2000,
    });
    act(() => useConfirm.getState().resolve(true));

    await waitFor(
      () => {
        const f = useOpenFiles.getState().files.find((x) => x.id === id)!;
        expect(f.markdown).toBe("external content");
        expect(f.isDirty).toBe(false);
      },
      { timeout: 2000 }
    );
  });

  it("keeps the user's edits and acknowledges the new mtime when the user declines", async () => {
    const id = seedActiveFile({
      name: "c.md",
      path: "c.md",
      markdown: "my edits",
      serverModified: "2026-05-20T00:00:00Z",
      isDirty: true,
    });

    server.use(
      http.get(`${API_BASE}/api/stat/c.md`, () =>
        HttpResponse.json({ path: "c.md", modified: "2026-05-21T00:00:00Z" })
      )
    );

    renderHook(() => useFileWatcher(POLL_MS), { wrapper });

    await waitFor(() => expect(useConfirm.getState().pending).not.toBeNull(), {
      timeout: 2000,
    });
    act(() => useConfirm.getState().resolve(false));

    await waitFor(
      () => {
        const f = useOpenFiles.getState().files.find((x) => x.id === id)!;
        expect(f.markdown).toBe("my edits");
        expect(f.isDirty).toBe(true);
        expect(f.serverModified).toBe("2026-05-21T00:00:00Z");
      },
      { timeout: 2000 }
    );
  });

  it("skips files without a serverModified baseline (e.g. fresh untitled buffers)", async () => {
    const statSpy = vi.fn(() =>
      HttpResponse.json({ path: "untitled.md", modified: "2026-05-21T00:00:00Z" })
    );
    server.use(http.get(`${API_BASE}/api/stat/*`, statSpy));

    seedActiveFile({
      name: "untitled.md",
      path: "untitled.md",
      markdown: "",
      serverModified: "",
    });

    renderHook(() => useFileWatcher(POLL_MS), { wrapper });

    await new Promise((r) => setTimeout(r, POLL_MS * 5));
    expect(statSpy).not.toHaveBeenCalled();
  });

  it("does not poll on an interval when paused (SSE connected)", async () => {
    const statSpy = vi.fn(() =>
      HttpResponse.json({ path: "a.md", modified: "2026-05-20T00:00:00Z" })
    );
    server.use(http.get(`${API_BASE}/api/stat/a.md`, statSpy));

    seedActiveFile({
      name: "a.md",
      path: "a.md",
      markdown: "old content",
      serverModified: "2026-05-20T00:00:00Z",
    });

    renderHook(() => useFileWatcher(POLL_MS, { paused: true }), { wrapper });

    await new Promise((r) => setTimeout(r, POLL_MS * 5));
    expect(statSpy).not.toHaveBeenCalled();
  });

  it("fires an immediate check when trigger changes, even while paused", async () => {
    const id = seedActiveFile({
      name: "a.md",
      path: "a.md",
      markdown: "old content",
      serverModified: "2026-05-20T00:00:00Z",
    });

    server.use(
      http.get(`${API_BASE}/api/stat/a.md`, () =>
        HttpResponse.json({ path: "a.md", modified: "2026-05-21T00:00:00Z" })
      ),
      http.get(`${API_BASE}/api/files/a.md`, () =>
        HttpResponse.json({
          path: "a.md",
          content: "pushed content",
          modified: "2026-05-21T00:00:00Z",
        })
      )
    );

    const { rerender } = renderHook(
      ({ trigger }: { trigger: number }) =>
        useFileWatcher(POLL_MS, { paused: true, trigger }),
      { wrapper, initialProps: { trigger: 0 } }
    );

    rerender({ trigger: 1 });

    await waitFor(
      () => {
        const f = useOpenFiles.getState().files.find((x) => x.id === id)!;
        expect(f.markdown).toBe("pushed content");
      },
      { timeout: 2000 }
    );
  });

  // --- changed-paths mark clearing (#178 round 2) ---------------------------

  it("clears the file's unread mark once the auto-reload silently applies the external content", async () => {
    const id = seedActiveFile({
      name: "a.md",
      path: "a.md",
      markdown: "old content",
      serverModified: "2026-05-20T00:00:00Z",
    });
    // Simulate the tree watcher having already flagged this path as unread
    // (e.g. it was seen while some other tab was active).
    useChangedPaths.getState().mark(ROOT, "a.md");

    server.use(
      http.get(`${API_BASE}/api/stat/a.md`, () =>
        HttpResponse.json({ path: "a.md", modified: "2026-05-21T00:00:00Z" })
      ),
      http.get(`${API_BASE}/api/files/a.md`, () =>
        HttpResponse.json({
          path: "a.md",
          content: "new content",
          modified: "2026-05-21T00:00:00Z",
        })
      )
    );

    renderHook(() => useFileWatcher(POLL_MS), { wrapper });

    await waitFor(
      () => {
        const f = useOpenFiles.getState().files.find((x) => x.id === id)!;
        expect(f.markdown).toBe("new content");
      },
      { timeout: 2000 }
    );
    expect(useChangedPaths.getState().isChanged(ROOT, "a.md")).toBe(false);
  });

  it("clears the file's unread mark once the user declines and keeps their own edits", async () => {
    seedActiveFile({
      name: "c.md",
      path: "c.md",
      markdown: "my edits",
      serverModified: "2026-05-20T00:00:00Z",
      isDirty: true,
    });
    useChangedPaths.getState().mark(ROOT, "c.md");

    server.use(
      http.get(`${API_BASE}/api/stat/c.md`, () =>
        HttpResponse.json({ path: "c.md", modified: "2026-05-21T00:00:00Z" })
      )
    );

    renderHook(() => useFileWatcher(POLL_MS), { wrapper });

    await waitFor(() => expect(useConfirm.getState().pending).not.toBeNull(), {
      timeout: 2000,
    });
    act(() => useConfirm.getState().resolve(false));

    await waitFor(() => {
      expect(useChangedPaths.getState().isChanged(ROOT, "c.md")).toBe(false);
    });
  });

  // #178 round 4 (codex review, adopted): a touch (or a rewrite with
  // identical bytes) on the actively-viewed file confirms via sha that
  // nothing actually changed, but that reconcile path used to `return`
  // before reaching clearChanged — so an unread mark set by an earlier
  // tree/dir-diff signal stayed lit on a file the user is already looking
  // at, with nothing new to see. AI tools/editors that rewrite a file with
  // the same content are a real source of this, not hypothetical.
  it("clears the file's unread mark on a sha-confirmed touch (mtime bumped, content unchanged)", async () => {
    const id = seedActiveFile({
      name: "a.md",
      path: "a.md",
      markdown: "old content",
      serverModified: "2026-05-20T00:00:00Z",
      serverSha: "sha-same",
    });
    useChangedPaths.getState().mark(ROOT, "a.md");

    server.use(
      http.get(`${API_BASE}/api/stat/a.md`, () =>
        HttpResponse.json({
          path: "a.md",
          modified: "2026-05-21T00:00:00Z", // mtime bumped
          sha: "sha-same", // content unchanged
        })
      )
    );

    renderHook(() => useFileWatcher(POLL_MS), { wrapper });

    await waitFor(() => {
      const f = useOpenFiles.getState().files.find((x) => x.id === id)!;
      expect(f.serverModified).toBe("2026-05-21T00:00:00Z");
    });
    expect(useChangedPaths.getState().isChanged(ROOT, "a.md")).toBe(false);
  });

  // #178 round 4 (codex review, adopted): same rationale as the touch case
  // above, for the no-sha-baseline backfill path — once the sha is learned
  // and mtimes agree, there is nothing external to report as unread either.
  it("clears the file's unread mark when a rehydrated tab's serverSha is backfilled (mtime unchanged)", async () => {
    const id = seedActiveFile({
      name: "a.md",
      path: "a.md",
      markdown: "old content",
      serverModified: "2026-05-20T00:00:00Z",
      // serverSha intentionally omitted — simulates a tab persisted before #119.
    });
    useChangedPaths.getState().mark(ROOT, "a.md");

    server.use(
      http.get(`${API_BASE}/api/stat/a.md`, () =>
        HttpResponse.json({
          path: "a.md",
          modified: "2026-05-20T00:00:00Z", // same mtime as baseline
          sha: "sha-backfilled",
        })
      )
    );

    renderHook(() => useFileWatcher(POLL_MS), { wrapper });

    await waitFor(() => {
      const f = useOpenFiles.getState().files.find((x) => x.id === id)!;
      expect(f.serverSha).toBe("sha-backfilled");
    });
    expect(useChangedPaths.getState().isChanged(ROOT, "a.md")).toBe(false);
  });

  // --- sha-first comparison (#119) ------------------------------------------

  it("case 1: reloads when the sha differs even though mtime is identical (same-second double save)", async () => {
    const id = seedActiveFile({
      name: "a.md",
      path: "a.md",
      markdown: "old content",
      serverModified: "2026-05-20T00:00:00Z",
      serverSha: "sha-old",
    });

    server.use(
      http.get(`${API_BASE}/api/stat/a.md`, () =>
        HttpResponse.json({
          path: "a.md",
          modified: "2026-05-20T00:00:00Z", // identical mtime
          sha: "sha-new",
        })
      ),
      http.get(`${API_BASE}/api/files/a.md`, () =>
        HttpResponse.json({
          path: "a.md",
          content: "new content",
          modified: "2026-05-20T00:00:00Z",
          sha: "sha-new",
        })
      )
    );

    renderHook(() => useFileWatcher(POLL_MS), { wrapper });

    await waitFor(
      () => {
        const f = useOpenFiles.getState().files.find((x) => x.id === id)!;
        expect(f.markdown).toBe("new content");
        expect(f.serverSha).toBe("sha-new");
        expect(f.isDirty).toBe(false);
      },
      { timeout: 2000 }
    );
    expect(useToast.getState().toasts.some((t) => t.severity === "info")).toBe(true);
  });

  it("case 2: a touch (new mtime, same sha) silently updates serverModified without reload/dialog", async () => {
    const id = seedActiveFile({
      name: "a.md",
      path: "a.md",
      markdown: "old content",
      serverModified: "2026-05-20T00:00:00Z",
      serverSha: "sha-same",
    });

    let readCalled = false;
    server.use(
      http.get(`${API_BASE}/api/stat/a.md`, () =>
        HttpResponse.json({
          path: "a.md",
          modified: "2026-05-21T00:00:00Z", // mtime bumped
          sha: "sha-same", // content unchanged
        })
      ),
      http.get(`${API_BASE}/api/files/a.md`, () => {
        readCalled = true;
        return HttpResponse.json({
          path: "a.md",
          content: "old content",
          modified: "2026-05-21T00:00:00Z",
          sha: "sha-same",
        });
      })
    );

    renderHook(() => useFileWatcher(POLL_MS), { wrapper });

    await waitFor(
      () => {
        const f = useOpenFiles.getState().files.find((x) => x.id === id)!;
        expect(f.serverModified).toBe("2026-05-21T00:00:00Z");
      },
      { timeout: 2000 }
    );

    // Give a couple more ticks a chance to (incorrectly) fire a reload.
    await new Promise((r) => setTimeout(r, POLL_MS * 3));
    const f = useOpenFiles.getState().files.find((x) => x.id === id)!;
    expect(f.markdown).toBe("old content"); // unchanged buffer, no swap needed
    expect(f.isDirty).toBe(false);
    expect(readCalled).toBe(false);
    expect(useConfirm.getState().pending).toBeNull();
  });

  it("backfills serverSha for a rehydrated tab (no baseline sha) once mtimes agree", async () => {
    const id = seedActiveFile({
      name: "a.md",
      path: "a.md",
      markdown: "old content",
      serverModified: "2026-05-20T00:00:00Z",
      // serverSha intentionally omitted — simulates a tab persisted before #119.
    });

    server.use(
      http.get(`${API_BASE}/api/stat/a.md`, () =>
        HttpResponse.json({
          path: "a.md",
          modified: "2026-05-20T00:00:00Z", // same mtime as baseline
          sha: "sha-backfilled",
        })
      )
    );

    renderHook(() => useFileWatcher(POLL_MS), { wrapper });

    await waitFor(
      () => {
        const f = useOpenFiles.getState().files.find((x) => x.id === id)!;
        expect(f.serverSha).toBe("sha-backfilled");
      },
      { timeout: 2000 }
    );
    const f = useOpenFiles.getState().files.find((x) => x.id === id)!;
    expect(f.markdown).toBe("old content");
    expect(f.isDirty).toBe(false);
  });

  // --- the dialog answer survives an effect re-run (#201) -------------------
  //
  // The confirm dialog is awaited inside the effect, so the effect's cleanup
  // used to invalidate the pending answer. Both `trigger` and `paused` are in
  // the dependency array and change routinely while the dialog is on screen
  // (a second `file` event for the same path, a visibilitychange, an SSE
  // reconnect), which silently dropped whatever the user picked.

  it("applies the accepted external content even when trigger changes while the dialog is open", async () => {
    const id = seedActiveFile({
      name: "d.md",
      path: "d.md",
      markdown: "my edits",
      serverModified: "2026-05-20T00:00:00Z",
      isDirty: true,
    });

    server.use(
      http.get(`${API_BASE}/api/stat/d.md`, () =>
        HttpResponse.json({ path: "d.md", modified: "2026-05-21T00:00:00Z" })
      ),
      http.get(`${API_BASE}/api/files/d.md`, () =>
        HttpResponse.json({
          path: "d.md",
          content: "external content",
          modified: "2026-05-21T00:00:00Z",
        })
      )
    );

    const { rerender } = renderHook(
      ({ trigger }: { trigger: number }) =>
        useFileWatcher(POLL_MS, { paused: true, trigger }),
      { wrapper, initialProps: { trigger: 1 } }
    );

    await waitFor(() => expect(useConfirm.getState().pending).not.toBeNull(), {
      timeout: 2000,
    });

    // A second `file` event for the same path lands while the user is still
    // looking at the dialog.
    rerender({ trigger: 2 });

    act(() => useConfirm.getState().resolve(true));

    await waitFor(
      () => {
        const f = useOpenFiles.getState().files.find((x) => x.id === id)!;
        expect(f.markdown).toBe("external content");
        expect(f.isDirty).toBe(false);
      },
      { timeout: 2000 }
    );
  });

  it("keeps the user's edits even when paused flips while the dialog is open", async () => {
    const id = seedActiveFile({
      name: "e.md",
      path: "e.md",
      markdown: "my edits",
      serverModified: "2026-05-20T00:00:00Z",
      isDirty: true,
    });

    server.use(
      http.get(`${API_BASE}/api/stat/e.md`, () =>
        HttpResponse.json({ path: "e.md", modified: "2026-05-21T00:00:00Z" })
      )
    );

    const { rerender } = renderHook(
      ({ paused }: { paused: boolean }) => useFileWatcher(POLL_MS, { paused }),
      { wrapper, initialProps: { paused: false } }
    );

    await waitFor(() => expect(useConfirm.getState().pending).not.toBeNull(), {
      timeout: 2000,
    });

    // The tab is hidden (or the SSE channel (re)connects) while the dialog is
    // still up, flipping `paused`.
    rerender({ paused: true });

    act(() => useConfirm.getState().resolve(false));

    await waitFor(
      () => {
        const f = useOpenFiles.getState().files.find((x) => x.id === id)!;
        expect(f.serverModified).toBe("2026-05-21T00:00:00Z");
      },
      { timeout: 2000 }
    );
    const f = useOpenFiles.getState().files.find((x) => x.id === id)!;
    expect(f.markdown).toBe("my edits");
    expect(f.isDirty).toBe(true);
  });

  it("acknowledges the newest on-disk state when declining, not the pre-dialog one", async () => {
    const id = seedActiveFile({
      name: "g.md",
      path: "g.md",
      markdown: "my edits",
      serverModified: "2026-05-20T00:00:00Z",
      serverSha: "sha-base",
      isDirty: true,
    });

    // The first stat opens the dialog; every stat after it reports a *second*
    // external write that landed while the dialog was up. Its own trigger is
    // swallowed by the pendingPathRef guard, so the decline branch is the
    // only place that can still notice it.
    let statCalls = 0;
    server.use(
      http.get(`${API_BASE}/api/stat/g.md`, () => {
        statCalls += 1;
        return statCalls === 1
          ? HttpResponse.json({
              path: "g.md",
              modified: "2026-05-21T00:00:00Z",
              sha: "sha-first",
            })
          : HttpResponse.json({
              path: "g.md",
              modified: "2026-05-22T00:00:00Z",
              sha: "sha-second",
            });
      })
    );

    renderHook(() => useFileWatcher(POLL_MS, { paused: true, trigger: 1 }), {
      wrapper,
    });

    await waitFor(() => expect(useConfirm.getState().pending).not.toBeNull(), {
      timeout: 2000,
    });
    act(() => useConfirm.getState().resolve(false));

    await waitFor(
      () => {
        const f = useOpenFiles.getState().files.find((x) => x.id === id)!;
        expect(f.serverSha).toBe("sha-second");
        expect(f.serverModified).toBe("2026-05-22T00:00:00Z");
      },
      { timeout: 2000 }
    );
    const f = useOpenFiles.getState().files.find((x) => x.id === id)!;
    expect(f.markdown).toBe("my edits");
    expect(f.isDirty).toBe(true);
  });

  it("does not act on the dialog answer once the hook has unmounted", async () => {
    const id = seedActiveFile({
      name: "f.md",
      path: "f.md",
      markdown: "my edits",
      serverModified: "2026-05-20T00:00:00Z",
      isDirty: true,
    });

    server.use(
      http.get(`${API_BASE}/api/stat/f.md`, () =>
        HttpResponse.json({ path: "f.md", modified: "2026-05-21T00:00:00Z" })
      ),
      http.get(`${API_BASE}/api/files/f.md`, () =>
        HttpResponse.json({
          path: "f.md",
          content: "external content",
          modified: "2026-05-21T00:00:00Z",
        })
      )
    );

    const { unmount } = renderHook(() => useFileWatcher(POLL_MS), { wrapper });

    await waitFor(() => expect(useConfirm.getState().pending).not.toBeNull(), {
      timeout: 2000,
    });

    unmount();
    act(() => useConfirm.getState().resolve(true));

    await new Promise((r) => setTimeout(r, POLL_MS * 10));
    const f = useOpenFiles.getState().files.find((x) => x.id === id)!;
    expect(f.markdown).toBe("my edits");
  });
});
