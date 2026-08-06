import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import { EditorPage } from "./EditorPage";
import { useOpenFiles } from "@/hooks/useOpenFiles";
import { useChangedPaths } from "@/hooks/useChangedPaths";

const API_BASE = "http://localhost:8080";

vi.mock("@/components/tiptap/TiptapEditor", () => ({
  TiptapEditor: () => <div data-testid="tiptap-editor" />,
}));

/**
 * Minimal EventSource stand-in (mirrors EditorPage.sse-sweep.test.tsx /
 * EditorPage.sse-badge.test.tsx): jsdom has no native EventSource, so we stub
 * it globally and drive `tree` events by hand.
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

  close() {
    this.closed = true;
  }
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/"]}>
        <EditorPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return client;
}

/**
 * #178 round 3: the SSE `tree` event (carrying the exact changed file's
 * root/path/mtime, see internal/events/watcher.go) is now the primary
 * "unread mark" signal — it works regardless of the sidebar tree's
 * expand/collapse state, unlike the dir-listing snapshot diff
 * (useDirChangeWatcher), which only observes files inside directories that
 * are currently expanded/mounted.
 */
describe("EditorPage SSE tree-event unread marking (#178 round 3)", () => {
  beforeEach(() => {
    localStorage.clear();
    useOpenFiles.setState({ files: [], activeIdByRoot: {} });
    useChangedPaths.setState({ changed: new Set(), selfWrites: new Set() });
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("marks a file when an SSE tree event names it", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-dir-docs")).toBeInTheDocument()
    );

    const instance = MockEventSource.instances[0];
    instance.emitMessage({
      kind: "tree",
      root: "mock-root",
      path: "docs/api/spec.md",
      mtime: "2026-05-22T00:00:00Z",
    });

    await waitFor(() =>
      expect(
        useChangedPaths.getState().isChanged("mock-root", "docs/api/spec.md")
      ).toBe(true)
    );
  });

  it("does not mark anything for a path-less tree event (ErrEventOverflow fallback)", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-dir-docs")).toBeInTheDocument()
    );

    const instance = MockEventSource.instances[0];
    instance.emitMessage({ kind: "tree", root: "mock-root", path: "" });

    await new Promise((r) => setTimeout(r, 30));
    expect(useChangedPaths.getState().changed.size).toBe(0);
  });

  it("does not mark when the tree event's mtime matches a registered self-write signature", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument()
    );

    useChangedPaths
      .getState()
      .registerSelfWrite("mock-root", "README.md", "2026-05-22T00:00:00Z");

    const instance = MockEventSource.instances[0];
    instance.emitMessage({
      kind: "tree",
      root: "mock-root",
      path: "README.md",
      mtime: "2026-05-22T00:00:00Z",
    });

    await new Promise((r) => setTimeout(r, 30));
    expect(useChangedPaths.getState().isChanged("mock-root", "README.md")).toBe(
      false
    );
  });

  it("keeps a self-write signature usable across both the SSE event and the dir-diff fallback for the same save", async () => {
    let readmeModified = "2026-05-20T00:00:00Z";
    server.use(
      http.get(`${API_BASE}/api/dirs`, ({ request }) => {
        const url = new URL(request.url);
        const path = url.searchParams.get("path") ?? "";
        if (path !== "") return HttpResponse.json({ root: "mock-root", entries: [] });
        return HttpResponse.json({
          root: "mock-root",
          entries: [
            {
              name: "README.md",
              path: "README.md",
              type: "file",
              modified: readmeModified,
            },
          ],
        });
      })
    );

    const client = renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument()
    );

    useChangedPaths
      .getState()
      .registerSelfWrite("mock-root", "README.md", "2026-05-22T00:00:00Z");

    // 1st match: the SSE tree event echoes the save.
    const instance = MockEventSource.instances[0];
    instance.emitMessage({
      kind: "tree",
      root: "mock-root",
      path: "README.md",
      mtime: "2026-05-22T00:00:00Z",
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(useChangedPaths.getState().isChanged("mock-root", "README.md")).toBe(
      false
    );

    // 2nd match: the dir-listing poll independently observes the same new
    // mtime. A destructive (delete-on-match) signature check would have
    // nothing left here and would incorrectly mark the file (round 2 bug).
    readmeModified = "2026-05-22T00:00:00Z";
    await client.refetchQueries({ queryKey: ["dir"] });
    await new Promise((r) => setTimeout(r, 30));
    expect(useChangedPaths.getState().isChanged("mock-root", "README.md")).toBe(
      false
    );
  });

  it("marks a deeply nested file via SSE while its ancestor directory is collapsed, lighting up the ancestor dot", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-dir-docs")).toBeInTheDocument()
    );
    // docs is NOT expanded — docs/api/spec.md's own useDir never mounts, so
    // the dir-diff fallback alone could never observe this change.
    expect(
      screen.queryByTestId("sidebar-file-docs/api/spec.md")
    ).not.toBeInTheDocument();

    const instance = MockEventSource.instances[0];
    instance.emitMessage({
      kind: "tree",
      root: "mock-root",
      path: "docs/api/spec.md",
      mtime: "2026-05-22T00:00:00Z",
    });

    await waitFor(() =>
      expect(screen.getByTestId("sidebar-changed-dot-docs")).toBeInTheDocument()
    );
  });
});
