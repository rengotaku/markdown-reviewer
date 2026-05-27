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
        initialHash: "hash",
        serverModified: opts.serverModified,
        serverCreated: "",
      },
    ],
    activeIdByRoot: { [ROOT]: id },
  });
  return id;
}

// useFileWatcher pulls the active root from `useActiveRoot`, which in turn
// reads from the URL (?tab=) and /api/config. The watcher hook is wrapped
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
    useConfirm.setState({ pending: null });
    useToast.setState({ toasts: [] });
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
});
