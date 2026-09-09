// Issue #282: "restore this version" wiring from DiffView through to the
// open-files store. Exercises the full round trip — click the diff toggle,
// select a baseline, restore it, and confirm both the success and failure
// paths land where the rest of the save/reload machinery expects them
// (savedMarkdown/markdown, isDirty, reviewRefresh-triggered relist, toasts).
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { server } from "@/test/mocks/server";
import { EditorPage } from "./EditorPage";
import { useOpenFiles } from "@/hooks/useOpenFiles";
import { useToast } from "@/hooks/useToast";
import { useConfirm } from "@/hooks/useConfirm";
import { useUIStore } from "@/hooks/useUIStore";
import { useEditorInstance } from "@/hooks/useEditorInstance";

vi.mock("@/components/tiptap/TiptapEditor", () => ({
  TiptapEditor: () => <div data-testid="tiptap-editor" />,
}));

const DEFAULT_ROOT = "mock-root";
const API_BASE = "http://localhost:8080";

function renderPage(initialPath = `/${DEFAULT_ROOT}`) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/:root/*" element={<EditorPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const REVISIONS = [
  { id: "r-002", ts: "2026-05-20T00:00:00Z", author: "ai" },
  { id: "r-001", ts: "2026-05-19T00:00:00Z", author: "ai" },
];

function mockUnderReview() {
  server.use(
    http.get(`${API_BASE}/api/stat/*`, () =>
      HttpResponse.json({
        path: "README.md",
        root: DEFAULT_ROOT,
        modified: "2026-05-20T00:00:00Z",
        created: "2026-05-19T00:00:00Z",
        state: "review",
        hasOpenComments: false,
      })
    ),
    http.get(`${API_BASE}/api/revisions/*`, ({ request }) => {
      const url = new URL(request.url);
      const id = url.searchParams.get("id");
      if (id) {
        return HttpResponse.json({
          id,
          ts: "2026-05-19T00:00:00Z",
          author: "ai",
          content: `# README.md\n\nrevision ${id} content`,
        });
      }
      return HttpResponse.json({
        path: "README.md",
        root: DEFAULT_ROOT,
        revisions: REVISIONS,
      });
    })
  );
}

async function openFileAndEnterDiffMode(user: ReturnType<typeof userEvent.setup>) {
  renderPage();
  await waitFor(() =>
    expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument()
  );
  await user.click(screen.getByTestId("sidebar-file-README.md"));
  await waitFor(() =>
    expect(screen.getByTestId("editor-diff-toggle")).not.toBeDisabled()
  );
  await user.click(screen.getByTestId("editor-diff-toggle"));
  await waitFor(() => expect(screen.getByTestId("diff-view")).toBeInTheDocument());
  await waitFor(() =>
    expect(screen.getByTestId("diff-btn-restore")).not.toBeDisabled()
  );
}

describe("EditorPage restore-to-this-version (#282)", () => {
  beforeEach(() => {
    localStorage.clear();
    useOpenFiles.setState({ files: [], activeIdByRoot: {} });
    useToast.setState({ toasts: [] });
    useConfirm.setState({ pending: null, queue: [] });
    useUIStore.setState({ isCommentPaneOpen: false });
    useEditorInstance.setState({ restoringFileId: null });
    mockUnderReview();
  });

  it("replaces the editor content and re-lists revisions after a successful restore", async () => {
    const user = userEvent.setup();
    let revisionListCalls = 0;
    server.use(
      http.get(`${API_BASE}/api/revisions/*`, ({ request }) => {
        const url = new URL(request.url);
        const id = url.searchParams.get("id");
        if (id) {
          return HttpResponse.json({
            id,
            ts: "2026-05-19T00:00:00Z",
            author: "ai",
            content: `# README.md\n\nrevision ${id} content`,
          });
        }
        revisionListCalls += 1;
        return HttpResponse.json({
          path: "README.md",
          root: DEFAULT_ROOT,
          // The second (post-restore) list gains the pre-restore snapshot.
          revisions:
            revisionListCalls > 1
              ? [{ id: "r-003", ts: "2026-05-21T00:00:00Z", author: "human" }, ...REVISIONS]
              : REVISIONS,
        });
      }),
      http.post(`${API_BASE}/api/revisions/*`, ({ request }) => {
        const url = new URL(request.url);
        const action = url.searchParams.get("action");
        expect(action).toBe("restore");
        expect(url.searchParams.get("id")).toBe("r-002");
        return HttpResponse.json({
          path: "README.md",
          content: "# README.md\n\nrevision r-002 content",
          modified: "2026-05-22T00:00:00Z",
          created: "2026-05-19T00:00:00Z",
          root: DEFAULT_ROOT,
          state: "review",
          sha: "restored-sha",
        });
      })
    );

    await openFileAndEnterDiffMode(user);
    await user.click(screen.getByTestId("diff-btn-restore"));
    await user.click(screen.getByTestId("diff-restore-confirm"));

    await waitFor(() =>
      expect(
        useToast.getState().toasts.some((t) => t.severity === "success")
      ).toBe(true)
    );

    const id = useOpenFiles.getState().activeIdByRoot[DEFAULT_ROOT];
    const file = useOpenFiles.getState().files.find((f) => f.id === id);
    expect(file?.markdown).toBe("# README.md\n\nrevision r-002 content");
    expect(file?.savedMarkdown).toBe("# README.md\n\nrevision r-002 content");
    expect(file?.isDirty).toBe(false);
    expect(file?.serverSha).toBe("restored-sha");

    // reviewRefresh must have fired at least once more than the initial load.
    await waitFor(() => expect(revisionListCalls).toBeGreaterThan(1));
  });

  it("reselects an existing revision in the picker after restore (#282 follow-up)", async () => {
    const user = userEvent.setup();
    let revisionListCalls = 0;
    server.use(
      http.get(`${API_BASE}/api/revisions/*`, ({ request }) => {
        const url = new URL(request.url);
        const id = url.searchParams.get("id");
        if (id) {
          return HttpResponse.json({
            id,
            ts: "2026-05-19T00:00:00Z",
            author: "ai",
            content: `# README.md\n\nrevision ${id} content`,
          });
        }
        revisionListCalls += 1;
        // Post-restore, the server has pushed the pre-restore body ("mock
        // content", from the generic /api/files/* fixture) as a brand new
        // revision at the head of the list.
        return HttpResponse.json({
          path: "README.md",
          root: DEFAULT_ROOT,
          revisions:
            revisionListCalls > 1
              ? [{ id: "r-003", ts: "2026-05-21T00:00:00Z", author: "human" }, ...REVISIONS]
              : REVISIONS,
        });
      }),
      http.post(`${API_BASE}/api/revisions/*`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("action")).toBe("restore");
        return HttpResponse.json({
          path: "README.md",
          content: "# README.md\n\nrevision r-002 content",
          modified: "2026-05-22T00:00:00Z",
          created: "2026-05-19T00:00:00Z",
          root: DEFAULT_ROOT,
          state: "review",
          sha: "restored-sha",
        });
      }),
      // The pre-restore snapshot (new r-003) holds what was on screen before
      // the restore — the same "mock content" body every open file starts
      // from in this suite.
      http.get(`${API_BASE}/api/revisions/README.md`, ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("id") === "r-003") {
          return HttpResponse.json({
            id: "r-003",
            ts: "2026-05-21T00:00:00Z",
            author: "human",
            content: "# README.md\n\nmock content",
          });
        }
        return HttpResponse.json({
          path: "README.md",
          root: DEFAULT_ROOT,
          revisions: [{ id: "r-003", ts: "2026-05-21T00:00:00Z", author: "human" }, ...REVISIONS],
        });
      })
    );

    await openFileAndEnterDiffMode(user);
    // Baseline before restoring: r-002 (the newest meaningful revision).
    await waitFor(() =>
      expect(screen.getByTestId("diff-revision-picker").textContent).toContain("r-002")
    );

    await user.click(screen.getByTestId("diff-btn-restore"));
    await user.click(screen.getByTestId("diff-restore-confirm"));

    await waitFor(() =>
      expect(
        useToast.getState().toasts.some((t) => t.severity === "success")
      ).toBe(true)
    );

    // The picker must land on a revision id that actually exists in the
    // fresh list (the bug: it stayed on the pre-restore "r-002" selection,
    // which the MUI Select can no longer resolve to an option once the list
    // moves on, rendering the picker blank) — and specifically the newest
    // one that differs from what's now on screen, so the diff reads as
    // "what did restoring just change".
    await waitFor(() =>
      expect(screen.getByTestId("diff-revision-picker").textContent).toContain("r-003")
    );
    const picker = screen.getByTestId("diff-revision-picker");
    expect(picker.textContent?.trim()).not.toBe("");
    // A real diff must be showing, not the "no changes" fallback the bug
    // produced once the picker's selection stopped resolving to anything.
    expect(
      screen.queryByText("このバージョンと現在の内容に差分はありません")
    ).not.toBeInTheDocument();
  });

  it("leaves the content untouched and shows an error toast when restore 404s", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${API_BASE}/api/revisions/*`, () =>
        HttpResponse.json({ error: "revision not found" }, { status: 404 })
      )
    );

    await openFileAndEnterDiffMode(user);

    const id = useOpenFiles.getState().activeIdByRoot[DEFAULT_ROOT];
    const before = useOpenFiles.getState().files.find((f) => f.id === id)?.markdown;

    await user.click(screen.getByTestId("diff-btn-restore"));
    await user.click(screen.getByTestId("diff-restore-confirm"));

    await waitFor(() =>
      expect(
        useToast.getState().toasts.some((t) => t.severity === "error")
      ).toBe(true)
    );

    const after = useOpenFiles.getState().files.find((f) => f.id === id)?.markdown;
    expect(after).toBe(before);
  });

  it("saves an unsaved edit before restoring, so it lands in the pre-restore snapshot instead of being lost (codex P1)", async () => {
    const user = userEvent.setup();
    const callOrder: string[] = [];
    let putBody = "";
    server.use(
      http.put(`${API_BASE}/api/files/*`, async ({ request }) => {
        callOrder.push("put");
        const body = (await request.json()) as { content: string };
        putBody = body.content;
        return HttpResponse.json({
          path: "README.md",
          root: DEFAULT_ROOT,
          content: body.content,
          modified: "2026-05-22T00:00:00Z",
          created: "2026-05-19T00:00:00Z",
          state: "review",
          sha: "autosaved-sha",
        });
      }),
      http.post(`${API_BASE}/api/revisions/*`, ({ request }) => {
        callOrder.push("restore");
        const url = new URL(request.url);
        expect(url.searchParams.get("action")).toBe("restore");
        return HttpResponse.json({
          path: "README.md",
          content: "# README.md\n\nrevision r-002 content",
          modified: "2026-05-23T00:00:00Z",
          created: "2026-05-19T00:00:00Z",
          root: DEFAULT_ROOT,
          state: "review",
          sha: "restored-sha",
        });
      })
    );

    await openFileAndEnterDiffMode(user);

    const id = useOpenFiles.getState().activeIdByRoot[DEFAULT_ROOT];
    act(() => {
      useOpenFiles
        .getState()
        .updateActiveMarkdown(DEFAULT_ROOT, "# README.md\n\nunsaved buffer\n");
      useOpenFiles.getState().markFileUserEdited(id!);
    });
    expect(useOpenFiles.getState().files.find((f) => f.id === id)?.isDirty).toBe(true);

    await user.click(screen.getByTestId("diff-btn-restore"));
    await user.click(screen.getByTestId("diff-restore-confirm"));

    await waitFor(() =>
      expect(
        useToast.getState().toasts.some((t) => t.severity === "success")
      ).toBe(true)
    );

    // The unsaved buffer must have been written to disk (and therefore into
    // the server's pre-restore snapshot) *before* the restore request went
    // out — reversing this order is exactly what used to lose it silently.
    expect(callOrder).toEqual(["put", "restore"]);
    expect(putBody).toBe("# README.md\n\nunsaved buffer\n");

    const file = useOpenFiles.getState().files.find((f) => f.id === id);
    expect(file?.markdown).toBe("# README.md\n\nrevision r-002 content");
    expect(file?.isDirty).toBe(false);
  });

  it("marks the file read-only (restoringFileId) for exactly the duration of the restore request (#282 follow-up P1)", async () => {
    const user = userEvent.setup();
    const releaseRestore: { current: () => void } = { current: () => {} };
    const restoreGate = new Promise<void>((resolve) => {
      releaseRestore.current = resolve;
    });
    server.use(
      http.post(`${API_BASE}/api/revisions/*`, async ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("action")).toBe("restore");
        await restoreGate;
        return HttpResponse.json({
          path: "README.md",
          content: "# README.md\n\nrevision r-002 content",
          modified: "2026-05-23T00:00:00Z",
          created: "2026-05-19T00:00:00Z",
          root: DEFAULT_ROOT,
          state: "review",
          sha: "restored-sha",
        });
      })
    );

    await openFileAndEnterDiffMode(user);
    const fileId = useOpenFiles.getState().activeIdByRoot[DEFAULT_ROOT];
    expect(useEditorInstance.getState().restoringFileId).toBeNull();

    await user.click(screen.getByTestId("diff-btn-restore"));
    await user.click(screen.getByTestId("diff-restore-confirm"));

    // While the request is in flight, the active file must be locked.
    await waitFor(() =>
      expect(useEditorInstance.getState().restoringFileId).toBe(fileId)
    );

    releaseRestore.current();

    await waitFor(() =>
      expect(
        useToast.getState().toasts.some((t) => t.severity === "success")
      ).toBe(true)
    );
    expect(useEditorInstance.getState().restoringFileId).toBeNull();
  });

  it("aborts the restore (and shows an error) instead of discarding the buffer when the pre-restore save fails", async () => {
    const user = userEvent.setup();
    let restoreCalls = 0;
    server.use(
      http.put(`${API_BASE}/api/files/*`, () =>
        HttpResponse.json({ error: "boom" }, { status: 500 })
      ),
      http.post(`${API_BASE}/api/revisions/*`, () => {
        restoreCalls += 1;
        return HttpResponse.json({
          path: "README.md",
          content: "# README.md\n\nrevision r-002 content",
          modified: "2026-05-23T00:00:00Z",
          created: "2026-05-19T00:00:00Z",
          root: DEFAULT_ROOT,
          state: "review",
          sha: "restored-sha",
        });
      })
    );

    await openFileAndEnterDiffMode(user);
    const id = useOpenFiles.getState().activeIdByRoot[DEFAULT_ROOT];
    act(() => {
      useOpenFiles
        .getState()
        .updateActiveMarkdown(DEFAULT_ROOT, "# README.md\n\nunsaved buffer\n");
      useOpenFiles.getState().markFileUserEdited(id!);
    });

    await user.click(screen.getByTestId("diff-btn-restore"));
    await user.click(screen.getByTestId("diff-restore-confirm"));

    await waitFor(() =>
      expect(
        useToast.getState().toasts.some((t) => t.severity === "error")
      ).toBe(true)
    );

    // Restore must never have been called, and the unsaved buffer must
    // still be sitting in the editor, dirty.
    expect(restoreCalls).toBe(0);
    const file = useOpenFiles.getState().files.find((f) => f.id === id);
    expect(file?.markdown).toBe("# README.md\n\nunsaved buffer\n");
    expect(file?.isDirty).toBe(true);
  });

  it("does not let a slow post-restore refetch for one file clobber another file's diff-view state after a tab switch (codex P1)", async () => {
    const user = userEvent.setup();
    let readmeListCalls = 0;
    // Stalls the post-restore relist indefinitely until the test releases
    // it, simulating a slow response that resolves only after the user has
    // switched tabs. (Object-wrapped like EditorPage.test.tsx's r002Gate —
    // a bare `let` reassigned only inside the Promise executor confuses
    // TS's control-flow narrowing into `never` at the call site below.)
    const releaseSecondReadmeList: { current: () => void } = { current: () => {} };
    const secondListGate = new Promise<void>((resolve) => {
      releaseSecondReadmeList.current = resolve;
    });

    server.use(
      http.get(`${API_BASE}/api/stat/*`, ({ request }) => {
        const url = new URL(request.url);
        const path = url.pathname.replace(/^\/api\/stat\//, "");
        return HttpResponse.json({
          path,
          root: DEFAULT_ROOT,
          modified: "2026-05-20T00:00:00Z",
          created: "2026-05-19T00:00:00Z",
          state: "review",
          hasOpenComments: false,
        });
      }),
      http.get(`${API_BASE}/api/revisions/README.md`, async ({ request }) => {
        const url = new URL(request.url);
        const id = url.searchParams.get("id");
        if (id) {
          return HttpResponse.json({
            id,
            ts: "2026-05-19T00:00:00Z",
            author: "ai",
            content: `# README.md\n\nrevision ${id} content`,
          });
        }
        readmeListCalls += 1;
        if (readmeListCalls > 1) {
          // The post-restore refetch: hang until the test lets it through,
          // simulating a slow response that resolves only after the user
          // has switched to a different tab.
          await secondListGate;
        }
        return HttpResponse.json({
          path: "README.md",
          root: DEFAULT_ROOT,
          revisions: REVISIONS,
        });
      }),
      http.post(`${API_BASE}/api/revisions/README.md`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("action")).toBe("restore");
        return HttpResponse.json({
          path: "README.md",
          content: "# README.md\n\nrevision r-002 content",
          modified: "2026-05-22T00:00:00Z",
          created: "2026-05-19T00:00:00Z",
          root: DEFAULT_ROOT,
          state: "review",
          sha: "restored-sha",
        });
      }),
      // docs/intro.md: a review file with no revisions of its own. This has
      // to be spelled out explicitly — the suite-wide mockUnderReview() from
      // beforeEach registers a wildcard `/api/revisions/*` handler that
      // hardcodes README.md's non-empty REVISIONS for *any* path, which
      // would otherwise shadow it here too.
      http.get(`${API_BASE}/api/revisions/docs/intro.md`, () =>
        HttpResponse.json({
          path: "docs/intro.md",
          root: DEFAULT_ROOT,
          revisions: [],
        })
      )
    );

    await openFileAndEnterDiffMode(user);
    await user.click(screen.getByTestId("diff-btn-restore"));
    await user.click(screen.getByTestId("diff-restore-confirm"));
    // The restore write itself always lands; only the reselection refetch
    // that follows is hung on secondListGate.
    await waitFor(() =>
      expect(
        useToast.getState().toasts.some((t) => t.severity === "success")
      ).toBe(true)
    );

    // Switch tabs while README.md's post-restore refetch is still hanging.
    await user.click(screen.getByTestId("sidebar-dir-docs"));
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-docs/intro.md")).toBeInTheDocument()
    );
    await user.click(screen.getByTestId("sidebar-file-docs/intro.md"));
    await waitFor(() =>
      expect(screen.getByTestId("editor-active-path")).toHaveTextContent("docs/intro.md")
    );

    // Now let the stale README.md response land.
    releaseSecondReadmeList.current();
    await waitFor(() => expect(readmeListCalls).toBeGreaterThan(1));

    // docs/intro.md is a review file with no revisions of its own. If
    // README.md's late response leaked into the shared page-level
    // `revisions` state, the diff toggle would wrongly treat this tab as
    // having comparable history — enabling the button — instead of staying
    // disabled with "no history yet". Checking the disabled state directly
    // (rather than clicking and asserting on a toast) matters here: with the
    // leak, clicking would just enter diff mode instead of ever showing that
    // toast, and the earlier "await waitFor(readmeListCalls > 1)" already
    // guarantees the stale response has landed by this point.
    await waitFor(() =>
      expect(screen.getByTestId("editor-active-path")).toHaveTextContent("docs/intro.md")
    );
    await waitFor(() =>
      expect(screen.getByTestId("editor-diff-toggle")).toBeDisabled()
    );

    // The button being disabled already proves no diff can be entered for
    // this tab — no "compared" toast, no diff view.
    expect(screen.queryByTestId("diff-view")).not.toBeInTheDocument();
    expect(
      useToast
        .getState()
        .toasts.some((t) => t.message === "比較できる過去リビジョンがまだありません")
    ).toBe(false);
  });


  it("does not let a slow post-restore refetch leak across a root switch, even though the old root's activeIdByRoot entry is untouched (codex P2)", async () => {
    const user = userEvent.setup();
    const OTHER_ROOT = "root-b";
    let mockRootListCalls = 0;
    const releaseMockRootList: { current: () => void } = { current: () => {} };
    const mockRootListGate = new Promise<void>((resolve) => {
      releaseMockRootList.current = resolve;
    });
    // root-b's own (legitimate) listRevisions call is gated too, so the test
    // controls the resolution order deterministically instead of relying on
    // whichever of the two in-flight requests happens to settle first.
    const releaseOtherRootList: { current: () => void } = { current: () => {} };
    const otherRootListGate = new Promise<void>((resolve) => {
      releaseOtherRootList.current = resolve;
    });

    server.use(
      http.get(`${API_BASE}/api/config`, () =>
        HttpResponse.json({
          review_root_name: DEFAULT_ROOT,
          review_root: "/tmp/mock-root",
          review_roots: [
            { name: DEFAULT_ROOT, path: "/tmp/mock-root" },
            { name: OTHER_ROOT, path: "/tmp/root-b" },
          ],
        })
      ),
      http.get(`${API_BASE}/api/stat/*`, () =>
        HttpResponse.json({
          path: "README.md",
          root: DEFAULT_ROOT,
          modified: "2026-05-20T00:00:00Z",
          created: "2026-05-19T00:00:00Z",
          state: "review",
          hasOpenComments: false,
        })
      ),
      // /api/revisions/README.md is requested for *both* roots (same file
      // name); root-aware so root-b's own "no history" shape doesn't get
      // confused with mock-root's.
      http.get(`${API_BASE}/api/revisions/README.md`, async ({ request }) => {
        const url = new URL(request.url);
        const root = url.searchParams.get("root") ?? DEFAULT_ROOT;
        const id = url.searchParams.get("id");
        if (root === OTHER_ROOT) {
          if (id) {
            return HttpResponse.json({
              id,
              ts: "2026-05-19T00:00:00Z",
              author: "ai",
              content: `# README.md (root-b)

revision ${id} content`,
            });
          }
          await otherRootListGate;
          return HttpResponse.json({ path: "README.md", root: OTHER_ROOT, revisions: [] });
        }
        if (id) {
          return HttpResponse.json({
            id,
            ts: "2026-05-19T00:00:00Z",
            author: "ai",
            content: `# README.md

revision ${id} content`,
          });
        }
        mockRootListCalls += 1;
        if (mockRootListCalls > 1) {
          // The post-restore refetch for mock-root: hang until the test
          // lets it through, simulating a slow response that resolves only
          // after the user has switched to a *different root*.
          await mockRootListGate;
        }
        return HttpResponse.json({ path: "README.md", root: DEFAULT_ROOT, revisions: REVISIONS });
      }),
      http.post(`${API_BASE}/api/revisions/README.md`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("action")).toBe("restore");
        return HttpResponse.json({
          path: "README.md",
          content: "# README.md\n\nrevision r-002 content",
          modified: "2026-05-22T00:00:00Z",
          created: "2026-05-19T00:00:00Z",
          root: DEFAULT_ROOT,
          state: "review",
          sha: "restored-sha",
        });
      })
    );

    await openFileAndEnterDiffMode(user);
    await user.click(screen.getByTestId("diff-btn-restore"));
    await user.click(screen.getByTestId("diff-restore-confirm"));
    await waitFor(() =>
      expect(
        useToast.getState().toasts.some((t) => t.severity === "success")
      ).toBe(true)
    );

    // Switch to a *different root* while mock-root's post-restore refetch
    // is still hanging. Note: this deliberately does NOT touch the tab
    // within mock-root — `activeIdByRoot["mock-root"]` still names the very
    // file being restored, which is exactly what let this leak through an
    // id-only guard (codex P2).
    await user.click(screen.getByTestId("sidebar-review-root"));
    await waitFor(() =>
      expect(screen.getByTestId("root-select-menu")).toBeInTheDocument()
    );
    await user.click(screen.getByTestId(`root-select-item-${OTHER_ROOT}`));
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument()
    );
    await user.click(screen.getByTestId("sidebar-file-README.md"));
    await waitFor(() =>
      expect(screen.getByTestId("editor-active-path")).toHaveTextContent("README.md")
    );

    // Deterministic ordering: let root-b's own (legitimate) fetch land
    // first and settle on "no history"...
    releaseOtherRootList.current();
    await waitFor(() =>
      expect(screen.getByTestId("editor-diff-toggle")).toBeDisabled()
    );

    // ...*then* let the stale mock-root response land while root-b is still
    // showing. If it leaks into the shared page-level `revisions` state (the
    // id-only guard bug — `activeIdByRoot["mock-root"]` still names the file
    // being restored even after switching to root-b), the diff toggle would
    // flip back to enabled with mock-root's non-empty history.
    releaseMockRootList.current();
    await waitFor(() => expect(mockRootListCalls).toBeGreaterThan(1));

    expect(screen.getByTestId("editor-diff-toggle")).toBeDisabled();
    expect(screen.queryByTestId("diff-view")).not.toBeInTheDocument();
  });
});
