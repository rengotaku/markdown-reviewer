import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { EditorPage } from "./EditorPage";
import { useOpenFiles, type OpenFile } from "@/hooks/useOpenFiles";
import { useToast } from "@/hooks/useToast";
import { useConfirm } from "@/hooks/useConfirm";
import { server } from "@/test/mocks/server";

const API_BASE = "http://localhost:8080";

vi.mock("@/components/tiptap/TiptapEditor", () => ({
  TiptapEditor: () => <div data-testid="tiptap-editor" />,
}));

/**
 * Minimal EventSource stand-in (same shape as the one in
 * EditorPage.sse-sweep.test.tsx): jsdom has no native EventSource, so the
 * SSE-connected code path is unreachable without a stub. These tests drive
 * open/error by hand to reproduce the exact transitions #173 is about.
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

  emitError() {
    this.onerror?.();
  }

  close() {
    this.closed = true;
  }
}

function makeOpenFile(
  overrides: Partial<OpenFile> & { id: string; path: string }
): OpenFile {
  return {
    name: overrides.path,
    root: "mock-root",
    markdown: "# stale buffer",
    savedMarkdown: "# stale buffer",
    isDirty: false,
    reloadToken: 0,
    serverModified: "2026-05-20T00:00:00Z",
    serverCreated: "2026-05-19T00:00:00Z",
    serverSha: "sha-v1",
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/"]}>
        <EditorPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/**
 * Rehydrate / reconnect reconcile (#173).
 *
 * The SSE channel only carries changes that happen while it is connected, so
 * a file rewritten while the page was closed (or while the connection was
 * down) produces no `file` event. Tabs are persisted to localStorage, so
 * without a reconcile on (re)connect the restored buffer stays stale forever
 * — and saving from it would overwrite the external change.
 */
describe("EditorPage rehydrate/reconnect reconcile (#173)", () => {
  beforeEach(() => {
    localStorage.clear();
    useOpenFiles.setState({ files: [], activeIdByRoot: {} });
    useToast.setState({ toasts: [] });
    useConfirm.setState({ pending: null, queue: [] });
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Serves the post-external-edit view of README.md (new sha + content). */
  function serveExternallyUpdatedReadme(content: string) {
    server.use(
      http.get(`${API_BASE}/api/stat/README.md`, () =>
        HttpResponse.json({
          path: "README.md",
          root: "mock-root",
          modified: "2026-05-21T00:00:00Z",
          created: "2026-05-19T00:00:00Z",
          state: "draft",
          sha: "sha-v2",
        })
      ),
      http.get(`${API_BASE}/api/files/README.md`, () =>
        HttpResponse.json({
          path: "README.md",
          root: "mock-root",
          content,
          modified: "2026-05-21T00:00:00Z",
          created: "2026-05-19T00:00:00Z",
          state: "draft",
          sha: "sha-v2",
        })
      )
    );
  }

  it("reloads a rehydrated tab whose file changed while the page was closed, once SSE connects", async () => {
    serveExternallyUpdatedReadme("# README.md\n\nchanged while the page was closed");

    // A tab restored from localStorage: its buffer predates the external edit
    // and no `file` event will ever announce that edit.
    useOpenFiles.setState({
      files: [makeOpenFile({ id: "a", path: "README.md" })],
      activeIdByRoot: { "mock-root": "a" },
    });

    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("editor-active-path")).toHaveTextContent("README.md")
    );

    MockEventSource.instances[0].emitOpen();

    await waitFor(() => {
      const f = useOpenFiles.getState().files.find((x) => x.id === "a")!;
      expect(f.markdown).toBe("# README.md\n\nchanged while the page was closed");
      expect(f.serverSha).toBe("sha-v2");
      expect(f.isDirty).toBe(false);
    });
    expect(useToast.getState().toasts.some((t) => t.severity === "info")).toBe(true);
  });

  it("leaves the buffer alone when nothing changed while the page was closed", async () => {
    // The common case: the reconcile must be a silent no-op, not a reload
    // (which would bump reloadToken and remount the editor) or a toast.
    let readCalls = 0;
    server.use(
      http.get(`${API_BASE}/api/stat/README.md`, () =>
        HttpResponse.json({
          path: "README.md",
          root: "mock-root",
          modified: "2026-05-20T00:00:00Z",
          created: "2026-05-19T00:00:00Z",
          state: "draft",
          sha: "sha-v1", // identical to the tab's baseline
        })
      ),
      http.get(`${API_BASE}/api/files/README.md`, () => {
        readCalls += 1;
        return HttpResponse.json({
          path: "README.md",
          root: "mock-root",
          content: "# README.md\n\nmock content",
          modified: "2026-05-20T00:00:00Z",
          created: "2026-05-19T00:00:00Z",
          state: "draft",
          sha: "sha-v1",
        });
      })
    );

    useOpenFiles.setState({
      files: [makeOpenFile({ id: "a", path: "README.md" })],
      activeIdByRoot: { "mock-root": "a" },
    });

    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("editor-active-path")).toHaveTextContent("README.md")
    );

    MockEventSource.instances[0].emitOpen();

    // Give the reconcile time to (incorrectly) reload before asserting it didn't.
    await new Promise((r) => setTimeout(r, 100));
    const f = useOpenFiles.getState().files.find((x) => x.id === "a")!;
    expect(f.markdown).toBe("# stale buffer");
    expect(f.reloadToken).toBe(0);
    expect(readCalls).toBe(0);
    expect(useToast.getState().toasts).toHaveLength(0);
  });

  it("reconciles again after a drop and reconnect (sleep / server restart)", async () => {
    // While disconnected the push channel carries nothing, so the change that
    // lands during the outage is only discoverable on reconnect.
    useOpenFiles.setState({
      files: [makeOpenFile({ id: "a", path: "README.md" })],
      activeIdByRoot: { "mock-root": "a" },
    });

    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("editor-active-path")).toHaveTextContent("README.md")
    );

    const source = MockEventSource.instances[0];
    source.emitOpen();
    // Let the first connect's reconcile settle (nothing has changed yet, so it
    // is a no-op) before simulating the drop.
    await new Promise((r) => setTimeout(r, 50));
    expect(useOpenFiles.getState().files[0].markdown).toBe("# stale buffer");

    source.emitError();
    // A real EventSource retries after a backoff, so onerror and the following
    // onopen never land in the same task/render batch — yield here so React
    // actually observes the disconnected state in between (otherwise the two
    // updates coalesce into "still connected" and there is no transition to
    // react to).
    await new Promise((r) => setTimeout(r, 0));
    serveExternallyUpdatedReadme("# README.md\n\nchanged during the outage");
    source.emitOpen();

    await waitFor(() => {
      const f = useOpenFiles.getState().files.find((x) => x.id === "a")!;
      expect(f.markdown).toBe("# README.md\n\nchanged during the outage");
      expect(f.serverSha).toBe("sha-v2");
    });
  });

  it("prompts before discarding a dirty rehydrated buffer instead of silently reloading", async () => {
    serveExternallyUpdatedReadme("# README.md\n\nexternal version");

    useOpenFiles.setState({
      files: [
        makeOpenFile({
          id: "a",
          path: "README.md",
          markdown: "# my unsaved edits",
          savedMarkdown: "# stale buffer",
          isDirty: true,
        }),
      ],
      activeIdByRoot: { "mock-root": "a" },
    });

    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("editor-active-path")).toHaveTextContent("README.md")
    );

    MockEventSource.instances[0].emitOpen();

    await waitFor(() => expect(useConfirm.getState().pending).not.toBeNull());
    expect(useOpenFiles.getState().files[0].markdown).toBe("# my unsaved edits");
  });
});
