import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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
 * Minimal EventSource stand-in (mirrors useServerEvents.test.tsx's
 * MockEventSource): jsdom has no native EventSource, so EditorPage.test.tsx
 * never actually exercises the SSE-connected code path. Tests in this file
 * specifically target that path (#114's onComments filter + stat-404
 * sweep-skip), so they stub EventSource globally and drive it by hand.
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

function makeOpenFile(overrides: Partial<OpenFile> & { id: string; path: string }): OpenFile {
  return {
    name: overrides.path,
    root: "mock-root",
    markdown: "# doc",
    savedMarkdown: "# doc",
    isDirty: false,
    reloadToken: 0,
    serverModified: "2026-05-20T00:00:00Z",
    serverCreated: "2026-05-19T00:00:00Z",
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
 * Installs both stat endpoints against one shared call log.
 *
 * The all-tabs sweep now goes through POST /api/stat/batch (#174) while the
 * per-active-file effect still uses GET /api/stat/*path, so a test asking
 * "was this path checked?" has to watch both. Paths reported by `failing`
 * come back as a 404 / a per-item not_found respectively — the two shapes the
 * same "this tab's file is gone" signal takes on each endpoint.
 */
function installStatHandlers(
  statPaths: string[],
  opts: {
    failing?: () => string[];
    beforeBatchRespond?: (paths: string[]) => Promise<void> | void;
  } = {}
) {
  const isFailing = (path: string) => (opts.failing?.() ?? []).includes(path);
  const okBody = (path: string) => ({
    path,
    root: "mock-root",
    modified: "2026-05-20T00:00:00Z",
    created: "2026-05-19T00:00:00Z",
    state: "draft",
    hasOpenComments: false,
  });

  server.use(
    http.get(`${API_BASE}/api/stat/*`, ({ request }) => {
      const path = new URL(request.url).pathname.replace(/^\/api\/stat\//, "");
      statPaths.push(path);
      if (isFailing(path)) {
        return HttpResponse.json({ error: "not found" }, { status: 404 });
      }
      return HttpResponse.json(okBody(path));
    }),
    http.post(`${API_BASE}/api/stat/batch`, async ({ request }) => {
      const body = (await request.json()) as {
        files: { root: string; path: string }[];
      };
      const paths = body.files.map((f) => f.path);
      // Logged before any stall so a test can observe the in-flight request,
      // matching how the GET handler behaved.
      statPaths.push(...paths);
      await opts.beforeBatchRespond?.(paths);
      return HttpResponse.json({
        results: body.files.map((f) =>
          isFailing(f.path)
            ? { root: f.root, path: f.path, hasOpenComments: false, error: "not_found" }
            : { root: f.root, path: f.path, state: "draft", hasOpenComments: false }
        ),
      });
    })
  );
}

describe("EditorPage SSE-driven review sweep (#114)", () => {
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

  it("does not sweep statFile for a comments event on a file with no open tab", async () => {
    const statPaths: string[] = [];
    installStatHandlers(statPaths);

    useOpenFiles.setState({
      files: [makeOpenFile({ id: "a", path: "README.md" })],
      activeIdByRoot: { "mock-root": "a" },
    });

    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("editor-active-path")).toHaveTextContent("README.md")
    );

    const before = statPaths.length;
    const instance = MockEventSource.instances[0];
    instance.emitMessage({
      kind: "comments",
      root: "mock-root",
      path: "docs/intro.md", // not an open tab
    });

    // Give any (incorrectly) triggered sweep a chance to fire before asserting
    // it didn't.
    await new Promise((r) => setTimeout(r, 50));
    expect(statPaths.length).toBe(before);
  });

  it("sweeps statFile for all open tabs when a comments event names an open tab", async () => {
    const statPaths: string[] = [];
    installStatHandlers(statPaths);

    useOpenFiles.setState({
      files: [
        makeOpenFile({ id: "a", path: "README.md" }),
        makeOpenFile({ id: "b", path: "docs/intro.md" }),
      ],
      activeIdByRoot: { "mock-root": "a" },
    });

    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("editor-active-path")).toHaveTextContent("README.md")
    );

    const before = statPaths.length;
    const instance = MockEventSource.instances[0];
    instance.emitMessage({
      kind: "comments",
      root: "mock-root",
      path: "docs/intro.md", // this IS an open tab (not the active one)
    });

    await waitFor(() => {
      // Sweep re-stats every open tab, so both README.md and docs/intro.md
      // should get an additional statFile call beyond the initial mount.
      const calledForIntro = statPaths.slice(before).filter((p) => p === "docs/intro.md");
      expect(calledForIntro.length).toBeGreaterThan(0);
    });
  });

  it("does not bump the sweep on file/tree events for a tab that was never missing (MEDIUM-1)", async () => {
    // onFile/onTree fire for every canonical-file change, not just ones tied
    // to a tab we'd given up on. Set.delete only returns true when the key
    // was actually present in missingStatFilesRef, so a `file`/`tree` event
    // naming a perfectly healthy open tab must be a no-op for the sweep —
    // otherwise every unrelated file edit would re-trigger a full tab sweep,
    // which is exactly the request storm #114 removed.
    const statPaths: string[] = [];
    installStatHandlers(statPaths);

    useOpenFiles.setState({
      files: [
        makeOpenFile({ id: "a", path: "README.md" }),
        makeOpenFile({ id: "b", path: "docs/intro.md" }),
      ],
      activeIdByRoot: { "mock-root": "a" },
    });

    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("editor-active-path")).toHaveTextContent("README.md")
    );

    const instance = MockEventSource.instances[0];
    const before = statPaths.length;

    // docs/intro.md was never stat-404'd, so this `file` event must not
    // trigger a fresh sweep of every open tab.
    instance.emitMessage({ kind: "file", root: "mock-root", path: "docs/intro.md" });
    // Give any (incorrectly) triggered sweep a chance to fire before
    // asserting it didn't.
    await new Promise((r) => setTimeout(r, 50));
    expect(statPaths.length).toBe(before);

    // Same for `tree`.
    instance.emitMessage({ kind: "tree", root: "mock-root", path: "docs/intro.md" });
    await new Promise((r) => setTimeout(r, 50));
    expect(statPaths.length).toBe(before);
  });

  it("stops calling statFile for a tab once it 404s, and resumes once activated", async () => {
    let introShouldFail = true;
    const statPaths: string[] = [];
    installStatHandlers(statPaths, {
      failing: () => (introShouldFail ? ["docs/intro.md"] : []),
    });

    useOpenFiles.setState({
      files: [
        makeOpenFile({ id: "a", path: "README.md" }),
        makeOpenFile({ id: "b", path: "docs/intro.md" }),
      ],
      activeIdByRoot: { "mock-root": "a" },
    });

    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("editor-active-path")).toHaveTextContent("README.md")
    );

    const instance = MockEventSource.instances[0];

    // First sweep: docs/intro.md 404s and should be recorded as missing.
    instance.emitMessage({ kind: "comments", root: "mock-root", path: "README.md" });
    await waitFor(() => {
      expect(statPaths.filter((p) => p === "docs/intro.md").length).toBeGreaterThan(0);
    });

    const introCallsAfterFirstSweep = statPaths.filter((p) => p === "docs/intro.md").length;

    // Second sweep: docs/intro.md should be skipped now (still 404 upstream,
    // but we shouldn't even ask).
    instance.emitMessage({ kind: "comments", root: "mock-root", path: "README.md" });
    await waitFor(() => {
      expect(statPaths.filter((p) => p === "README.md").length).toBeGreaterThan(1);
    });
    expect(statPaths.filter((p) => p === "docs/intro.md").length).toBe(
      introCallsAfterFirstSweep
    );

    // Activating the tab re-checks it regardless of the missing-set.
    introShouldFail = false;
    useOpenFiles.getState().setActive("mock-root", "b");
    await waitFor(() => {
      expect(statPaths.filter((p) => p === "docs/intro.md").length).toBeGreaterThan(
        introCallsAfterFirstSweep
      );
    });
  });

  it("resumes checking a stat-404'd tab once a matching file SSE event arrives", async () => {
    let introShouldFail = true;
    const statPaths: string[] = [];
    installStatHandlers(statPaths, {
      failing: () => (introShouldFail ? ["docs/intro.md"] : []),
    });

    useOpenFiles.setState({
      files: [
        makeOpenFile({ id: "a", path: "README.md" }),
        makeOpenFile({ id: "b", path: "docs/intro.md" }),
      ],
      activeIdByRoot: { "mock-root": "a" },
    });

    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("editor-active-path")).toHaveTextContent("README.md")
    );

    const instance = MockEventSource.instances[0];

    instance.emitMessage({ kind: "comments", root: "mock-root", path: "README.md" });
    await waitFor(() => {
      expect(statPaths.filter((p) => p === "docs/intro.md").length).toBeGreaterThan(0);
    });
    const introCallsAfterFirstSweep = statPaths.filter((p) => p === "docs/intro.md").length;

    // Confirm it's actually skipped on the next sweep before recovering it.
    instance.emitMessage({ kind: "comments", root: "mock-root", path: "README.md" });
    await waitFor(() => {
      expect(statPaths.filter((p) => p === "README.md").length).toBeGreaterThan(1);
    });
    expect(statPaths.filter((p) => p === "docs/intro.md").length).toBe(
      introCallsAfterFirstSweep
    );

    // A `file` event naming the previously-missing tab clears it, and the
    // next comments-driven sweep should check it again.
    introShouldFail = false;
    instance.emitMessage({ kind: "file", root: "mock-root", path: "docs/intro.md" });
    instance.emitMessage({ kind: "comments", root: "mock-root", path: "README.md" });
    await waitFor(() => {
      expect(statPaths.filter((p) => p === "docs/intro.md").length).toBeGreaterThan(
        introCallsAfterFirstSweep
      );
    });
  });

  it("clears a closed tab from the missing set so a future re-open gets a fresh check (HIGH-1)", async () => {
    let introShouldFail = true;
    const statPaths: string[] = [];
    installStatHandlers(statPaths, {
      failing: () => (introShouldFail ? ["docs/intro.md"] : []),
    });

    useOpenFiles.setState({
      files: [
        makeOpenFile({ id: "a", path: "README.md" }),
        makeOpenFile({ id: "b", path: "docs/intro.md" }),
      ],
      activeIdByRoot: { "mock-root": "a" },
    });

    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("editor-active-path")).toHaveTextContent("README.md")
    );

    const instance = MockEventSource.instances[0];

    // Sweep #1: docs/intro.md 404s and is recorded as missing.
    instance.emitMessage({ kind: "comments", root: "mock-root", path: "README.md" });
    await waitFor(() => {
      expect(statPaths.filter((p) => p === "docs/intro.md").length).toBeGreaterThan(0);
    });
    const introCallsWhileOpen = statPaths.filter((p) => p === "docs/intro.md").length;

    // Sanity: confirm it's actually being skipped before closing it.
    instance.emitMessage({ kind: "comments", root: "mock-root", path: "README.md" });
    await waitFor(() => {
      expect(statPaths.filter((p) => p === "README.md").length).toBeGreaterThan(1);
    });
    expect(statPaths.filter((p) => p === "docs/intro.md").length).toBe(introCallsWhileOpen);

    // Close the docs/intro.md tab via the tab-bar close icon (HIGH-1 close
    // path) — this must clear it from the missing set, not just drop the
    // OpenFile entry.
    await waitFor(() =>
      expect(screen.getByTestId("editor-tab-close-docs/intro.md")).toBeInTheDocument()
    );
    fireEvent.click(screen.getByTestId("editor-tab-close-docs/intro.md"));
    await waitFor(() =>
      expect(screen.queryByTestId("editor-tab-close-docs/intro.md")).not.toBeInTheDocument()
    );

    // Re-open the same path as a fresh tab (server now says it's fine) and
    // confirm the sweep checks it again instead of silently excluding it
    // forever because of the pre-close 404.
    introShouldFail = false;
    useOpenFiles.setState({
      files: [
        makeOpenFile({ id: "a", path: "README.md" }),
        makeOpenFile({ id: "c", path: "docs/intro.md" }),
      ],
      activeIdByRoot: { "mock-root": "a" },
    });
    instance.emitMessage({ kind: "comments", root: "mock-root", path: "README.md" });
    await waitFor(() => {
      expect(statPaths.filter((p) => p === "docs/intro.md").length).toBeGreaterThan(
        introCallsWhileOpen
      );
    });
  });

  it("does not re-exclude a tab from the sweep when a late 404 resolves after the tab was reactivated (HIGH-2)", async () => {
    // Simulates the race the coordinator flagged: a sweep's statFile for a
    // tab is in flight when the user activates that very tab. The
    // per-active-file effect fires its own (fast, successful) statFile call
    // afterwards, resolving before the sweep's stalled call. When the
    // sweep's request finally resolves 404, it must not undo the
    // already-established "this tab is fine" state — otherwise reactivating
    // a tab wouldn't reliably clear it from the missing set.
    //
    // The mount-time "sync review badge for all open tabs" sweep (#114)
    // fires once as soon as both tabs are open — that single call is what
    // gets stalled here; no extra SSE event is emitted before activation, so
    // there is exactly one in-flight docs/intro.md request to reason about.
    let introBatchCount = 0;
    // The stalled sweep must resolve not_found; the activation effect's own
    // GET must not, so the flag is cleared before releasing the gate.
    let introSweepShouldFail = true;
    // Wrapped in an object (not a bare `let`) so TS doesn't narrow the
    // reassigned-inside-a-closure variable back to its initial type.
    const release: { current: () => void } = { current: () => {} };
    const firstIntroCallGate = new Promise<void>((resolve) => {
      release.current = resolve;
    });
    const statPaths: string[] = [];

    // The sweep is the batched call now (#174), so that is what gets stalled;
    // the activation effect's own GET must still resolve immediately.
    installStatHandlers(statPaths, {
      failing: () => (introSweepShouldFail ? ["docs/intro.md"] : []),
      beforeBatchRespond: async (paths) => {
        if (!paths.includes("docs/intro.md")) return;
        introBatchCount += 1;
        if (introBatchCount === 1) await firstIntroCallGate;
      },
    });

    useOpenFiles.setState({
      files: [
        makeOpenFile({ id: "a", path: "README.md" }),
        makeOpenFile({ id: "b", path: "docs/intro.md" }),
      ],
      activeIdByRoot: { "mock-root": "a" },
    });

    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("editor-active-path")).toHaveTextContent("README.md")
    );
    // The mount-time sweep has already stalled on its docs/intro.md entry.
    await waitFor(() => expect(introBatchCount).toBe(1));

    const instance = MockEventSource.instances[0];

    // Activate docs/intro.md while the sweep's batch is still in flight —
    // this fires the per-active-file effect's own statFile GET, which
    // resolves immediately as success.
    introSweepShouldFail = false;
    useOpenFiles.getState().setActive("mock-root", "b");
    await waitFor(() =>
      expect(screen.getByTestId("editor-active-path")).toHaveTextContent("docs/intro.md")
    );
    await waitFor(() =>
      expect(statPaths.filter((p) => p === "docs/intro.md").length).toBeGreaterThan(1)
    );

    // Now release the stalled sweep — the guard must stop its late
    // not_found from undoing the "this tab is fine" state the activation
    // effect already established.
    release.current();
    // Give the sweep's rejected promise a chance to settle and (if the
    // race guard were absent) re-add docs/intro.md to the missing set.
    await new Promise((r) => setTimeout(r, 20));

    // Trigger another sweep — if the race guard worked, docs/intro.md is
    // still being checked (not excluded), because the sweep's late 404
    // must not have been allowed to mark the just-activated tab missing.
    const callsBeforeNextSweep = statPaths.filter((p) => p === "docs/intro.md").length;
    instance.emitMessage({ kind: "comments", root: "mock-root", path: "README.md" });
    await waitFor(() => {
      expect(statPaths.filter((p) => p === "docs/intro.md").length).toBeGreaterThan(
        callsBeforeNextSweep
      );
    });
  });
});
