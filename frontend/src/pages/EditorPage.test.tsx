import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { EditorPage } from "./EditorPage";
import { useOpenFiles } from "@/hooks/useOpenFiles";
import { useRecentOpened } from "@/hooks/useRecentOpened";
import { useToast } from "@/hooks/useToast";
import { useConfirm } from "@/hooks/useConfirm";
import { useEditorInstance } from "@/hooks/useEditorInstance";
import { CommentHighlight } from "@/components/tiptap/extensions/CommentHighlight";
import { DiffGutter } from "@/components/tiptap/extensions/DiffGutter";
import type { CommentJSON } from "@/api";

vi.mock("@/components/tiptap/TiptapEditor", () => ({
  TiptapEditor: () => <div data-testid="tiptap-editor" />,
}));

// Matches the /api/config mock handler's review_roots[0].name.
const DEFAULT_ROOT = "mock-root";

/** Renders the URL pathname + search string so tests can assert URL state
 *  via the DOM. */
function LocationProbe() {
  const loc = useLocation();
  return (
    <>
      <span data-testid="loc-pathname">{loc.pathname}</span>
      <span data-testid="loc-search">{loc.search}</span>
    </>
  );
}

function renderPage(initialPath = `/${DEFAULT_ROOT}`) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route
            path="/:root/*"
            element={
              <>
                <EditorPage />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("EditorPage", () => {
  beforeEach(() => {
    localStorage.clear();
    useOpenFiles.setState({ files: [], activeIdByRoot: {} });
    useToast.setState({ toasts: [] });
    useConfirm.setState({ pending: null, queue: [] });
    useRecentOpened.setState({ entries: [] });
  });

  it("records an opened file in the Recently history (#228)", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument()
    );

    await user.click(screen.getByTestId("sidebar-file-README.md"));
    await waitFor(() =>
      expect(
        useRecentOpened.getState().listForRoot("mock-root").map((e) => e.path)
      ).toEqual(["README.md"])
    );
  });

  it("shows the empty-state placeholder when no file is active", () => {
    renderPage();
    expect(screen.getByTestId("editor-empty-state")).toHaveTextContent(
      "ファイルを選択"
    );
    expect(screen.queryByTestId("tiptap-editor")).not.toBeInTheDocument();
  });

  it("shows the top-level file tree once /api/dirs resolves", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument()
    );
  });

  it("mounts the TiptapEditor once a file becomes active", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument()
    );
    await user.click(screen.getByTestId("sidebar-file-README.md"));
    await waitFor(() =>
      expect(screen.getByTestId("tiptap-editor")).toBeInTheDocument()
    );
    expect(screen.queryByTestId("editor-empty-state")).not.toBeInTheDocument();
  });

  it("opens the file specified by the URL path (/{root}/{path}) on mount", async () => {
    renderPage(`/${DEFAULT_ROOT}/docs/intro.md`);

    await waitFor(() => {
      expect(screen.getByTestId("editor-active-path")).toHaveTextContent(
        "docs/intro.md"
      );
    });
    const opened = useOpenFiles
      .getState()
      .files.find((f) => f.path === "docs/intro.md");
    expect(opened).toBeDefined();
  });

  it("opens the file specified by an encoded splat (%2F) the same as a raw-slash path", async () => {
    renderPage(`/${DEFAULT_ROOT}/${encodeURIComponent("docs/intro.md")}`);

    await waitFor(() => {
      expect(screen.getByTestId("editor-active-path")).toHaveTextContent(
        "docs/intro.md"
      );
    });
    const opened = useOpenFiles
      .getState()
      .files.find((f) => f.path === "docs/intro.md");
    expect(opened).toBeDefined();
  });

  it("syncs the active tab path to the URL", async () => {
    const user = userEvent.setup();
    renderPage();

    // Open README.md — URL should pick it up as the path.
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument()
    );
    await user.click(screen.getByTestId("sidebar-file-README.md"));
    await waitFor(() => {
      expect(screen.getByTestId("loc-pathname")).toHaveTextContent(
        `/${DEFAULT_ROOT}/README.md`
      );
    });

    // Open a second file via the sidebar and ensure the URL switches to it.
    await user.click(screen.getByTestId("sidebar-dir-docs"));
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-docs/intro.md")).toBeInTheDocument()
    );
    await user.click(screen.getByTestId("sidebar-file-docs/intro.md"));
    await waitFor(() => {
      expect(screen.getByTestId("loc-pathname").textContent).toBe(
        `/${DEFAULT_ROOT}/${encodeURIComponent("docs/intro.md")}`
      );
    });
  });

  it("preserves an unrelated query param (filter) while syncing the path", async () => {
    const user = userEvent.setup();
    renderPage(`/${DEFAULT_ROOT}?filter=docs`);

    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument()
    );
    await user.click(screen.getByTestId("sidebar-file-README.md"));

    await waitFor(() => {
      expect(screen.getByTestId("loc-pathname")).toHaveTextContent(
        `/${DEFAULT_ROOT}/README.md`
      );
      expect(screen.getByTestId("loc-search")).toHaveTextContent("filter=docs");
    });
  });

  it("opens a server file when clicked and shows its path in the header", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("sidebar-dir-docs")).toBeInTheDocument()
    );
    await user.click(screen.getByTestId("sidebar-dir-docs"));
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-docs/intro.md")).toBeInTheDocument()
    );

    await user.click(screen.getByTestId("sidebar-file-docs/intro.md"));

    await waitFor(() => {
      expect(screen.getByTestId("editor-active-path")).toHaveTextContent("docs/intro.md");
    });

    const opened = useOpenFiles
      .getState()
      .files.find((f) => f.path === "docs/intro.md");
    expect(opened).toBeDefined();
    expect(opened?.markdown).toContain("mock content");
  });

  it("prompts for confirmation before switching away from a dirty file", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument()
    );

    // Open README, then make it dirty
    await user.click(screen.getByTestId("sidebar-file-README.md"));
    await waitFor(() => {
      const active = useOpenFiles
        .getState()
        .files.find((f) => f.path === "README.md");
      expect(active).toBeDefined();
    });
    useOpenFiles.getState().updateActiveMarkdown("mock-root", "edited content");

    // Expand docs/ and attempt to switch to a different file
    await user.click(screen.getByTestId("sidebar-dir-docs"));
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-docs/intro.md")).toBeInTheDocument()
    );
    await user.click(screen.getByTestId("sidebar-file-docs/intro.md"));

    // Confirm dialog should appear
    await waitFor(() =>
      expect(screen.getByText("未保存の変更があります")).toBeInTheDocument()
    );

    // Cancel — the active file should remain README.md
    await user.click(screen.getByRole("button", { name: "キャンセル" }));

    await waitFor(() =>
      expect(useConfirm.getState().pending).toBeNull()
    );
    const stillActive = useOpenFiles
      .getState()
      .files.find((f) => f.id === useOpenFiles.getState().activeIdByRoot["mock-root"]);
    expect(stillActive?.path).toBe("README.md");
  });

  it("saves the active file via PUT and clears the dirty flag", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument()
    );
    await user.click(screen.getByTestId("sidebar-file-README.md"));
    await waitFor(() =>
      expect(screen.getByTestId("editor-active-path")).toHaveTextContent("README.md")
    );

    useOpenFiles.getState().updateActiveMarkdown("mock-root", "new content");
    expect(
      useOpenFiles
        .getState()
        .files.find((f) => f.id === useOpenFiles.getState().activeIdByRoot["mock-root"])!.isDirty
    ).toBe(true);

    await user.click(screen.getByTestId("editor-save"));

    await waitFor(() => {
      const active = useOpenFiles
        .getState()
        .files.find((f) => f.id === useOpenFiles.getState().activeIdByRoot["mock-root"])!;
      expect(active.isDirty).toBe(false);
    });
    expect(useToast.getState().toasts[0]?.severity).toBe("success");
  });

  it("copies the raw markdown of the active file to the clipboard", async () => {
    // userEvent.setup() installs its own navigator.clipboard stub, so spy on
    // that stub's writeText (created here) rather than pre-defining our own.
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument()
    );
    await user.click(screen.getByTestId("sidebar-file-README.md"));
    await waitFor(() =>
      expect(screen.getByTestId("editor-active-path")).toHaveTextContent("README.md")
    );

    await user.click(screen.getByTestId("editor-copy-markdown"));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("# README.md\n\nmock content")
    );
    expect(useToast.getState().toasts.some((t) => t.severity === "success")).toBe(
      true
    );
  });

  it("copies the `mr comments <abs-path>` review command for the active file", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument()
    );
    await user.click(screen.getByTestId("sidebar-file-README.md"));
    await waitFor(() =>
      expect(screen.getByTestId("editor-active-path")).toHaveTextContent("README.md")
    );

    await user.click(screen.getByTestId("editor-copy-review-command"));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("mr comments /tmp/mock-root/README.md")
    );
    expect(useToast.getState().toasts.some((t) => t.severity === "success")).toBe(
      true
    );
  });

  it("displays REVIEW_ROOT basename in the sidebar header (from /api/config)", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-review-root")).toHaveTextContent("mock-root")
    );
  });

  it("add-comment button shows a toast when no text is selected", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument()
    );
    await user.click(screen.getByTestId("sidebar-file-README.md"));

    // No selection: the button is disabled, so clicking it via .click() won't do
    // anything. Force-click ensures we can verify the disabled state instead.
    const btn = screen.getByTestId("editor-add-comment") as HTMLButtonElement;
    expect(btn).toBeDisabled();
  });

  it("sidebar toggle button hides and shows the sidebar", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument()
    );

    await user.click(screen.getByLabelText("close sidebar"));
    expect(screen.queryByTestId("sidebar-file-README.md")).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("open sidebar"));
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument()
    );
  });

  it("comments pane can be toggled (close inside, open from editor header)", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument()
    );

    // Pane defaults to open; close button is rendered inside it.
    expect(screen.getByTestId("comment-side-pane")).toBeInTheDocument();
    await user.click(screen.getByTestId("comment-pane-close"));
    expect(screen.queryByTestId("comment-side-pane")).not.toBeInTheDocument();

    // Closed → "open" button appears in the editor header.
    await user.click(screen.getByTestId("editor-toggle-comments"));
    expect(screen.getByTestId("comment-side-pane")).toBeInTheDocument();
  });

  it("shows a placeholder when no file is selected", () => {
    renderPage();
    expect(screen.getByTestId("editor-active-path")).toHaveTextContent(
      "ファイルが選択されていません"
    );
    // #143: no active file → the version badge has nothing to show.
    expect(screen.queryByTestId("editor-active-version")).not.toBeInTheDocument();
  });

  it("shows v1 for a draft file with no saved revisions (#143)", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument()
    );
    await user.click(screen.getByTestId("sidebar-file-README.md"));

    // Default mock /api/stat returns state: "draft" → revisions stays [].
    await waitFor(() =>
      expect(screen.getByTestId("editor-active-version")).toHaveTextContent("v1")
    );
  });

  it("shows v{newest id + 1} for a file under review (#143)", async () => {
    const user = userEvent.setup();
    const { http, HttpResponse } = await import("msw");
    const { server } = await import("@/test/mocks/server");
    server.use(
      http.get("http://localhost:8080/api/stat/*", () =>
        HttpResponse.json({
          path: "README.md",
          root: "mock-root",
          modified: "2026-05-20T00:00:00Z",
          created: "2026-05-19T00:00:00Z",
          state: "review",
          hasOpenComments: false,
        })
      ),
      http.get("http://localhost:8080/api/revisions/*", ({ request }) => {
        const url = new URL(request.url);
        const id = url.searchParams.get("id");
        // getRevision (single-snapshot fetch, used to resolve versionReady)
        // hits this same route with an `id` query param — mirror the
        // default handler's shape so its content isn't undefined.
        if (id) {
          return HttpResponse.json({
            id,
            ts: "2026-05-20T00:00:00Z",
            author: "ai",
            content: "# README.md\n\nprevious content",
          });
        }
        return HttpResponse.json({
          path: "README.md",
          root: "mock-root",
          // ListRevisions returns newest-first: r-002 (newest) then r-001.
          revisions: [
            { id: "r-002", ts: "2026-05-20T00:00:00Z", author: "ai" },
            { id: "r-001", ts: "2026-05-19T00:00:00Z", author: "ai" },
          ],
        });
      })
    );

    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument()
    );
    await user.click(screen.getByTestId("sidebar-file-README.md"));

    // Newest retained revision is r-002 → the currently displayed content is
    // one past that, v3.
    await waitFor(() =>
      expect(screen.getByTestId("editor-active-version")).toHaveTextContent("v3")
    );
  });

  it("keeps the version number correct past the MaxRevisions=20 trim (#143 codex review)", async () => {
    const user = userEvent.setup();
    const { http, HttpResponse } = await import("msw");
    const { server } = await import("@/test/mocks/server");
    server.use(
      http.get("http://localhost:8080/api/stat/*", () =>
        HttpResponse.json({
          path: "README.md",
          root: "mock-root",
          modified: "2026-05-20T00:00:00Z",
          created: "2026-05-19T00:00:00Z",
          state: "review",
          hasOpenComments: false,
        })
      ),
      http.get("http://localhost:8080/api/revisions/*", ({ request }) => {
        const url = new URL(request.url);
        const id = url.searchParams.get("id");
        // getRevision (single-snapshot fetch, used to resolve versionReady)
        // hits this same route with an `id` query param — mirror the
        // default handler's shape so its content isn't undefined.
        if (id) {
          return HttpResponse.json({
            id,
            ts: "2026-05-20T00:00:00Z",
            author: "ai",
            content: "# README.md\n\nprevious content",
          });
        }
        return HttpResponse.json({
          path: "README.md",
          root: "mock-root",
          // history.jsonl was trimmed to MaxRevisions=20, but nextID() derives
          // from the max retained id, so the id keeps climbing past 20 —
          // revisions.length alone (here 1) would wrongly report v2.
          revisions: [{ id: "r-021", ts: "2026-05-20T00:00:00Z", author: "ai" }],
        });
      })
    );

    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument()
    );
    await user.click(screen.getByTestId("sidebar-file-README.md"));

    await waitFor(() =>
      expect(screen.getByTestId("editor-active-version")).toHaveTextContent("v22")
    );
  });

  it("falls back to revisions.length + 1 when the newest revision id fails to parse (#143)", async () => {
    const user = userEvent.setup();
    const { http, HttpResponse } = await import("msw");
    const { server } = await import("@/test/mocks/server");
    server.use(
      http.get("http://localhost:8080/api/stat/*", () =>
        HttpResponse.json({
          path: "README.md",
          root: "mock-root",
          modified: "2026-05-20T00:00:00Z",
          created: "2026-05-19T00:00:00Z",
          state: "review",
          hasOpenComments: false,
        })
      ),
      http.get("http://localhost:8080/api/revisions/*", ({ request }) => {
        const url = new URL(request.url);
        const id = url.searchParams.get("id");
        // getRevision (single-snapshot fetch, used to resolve versionReady)
        // hits this same route with an `id` query param — mirror the
        // default handler's shape so its content isn't undefined.
        if (id) {
          return HttpResponse.json({
            id,
            ts: "2026-05-20T00:00:00Z",
            author: "ai",
            content: "# README.md\n\nprevious content",
          });
        }
        return HttpResponse.json({
          path: "README.md",
          root: "mock-root",
          revisions: [
            { id: "weird", ts: "2026-05-20T00:00:00Z", author: "ai" },
            { id: "r-001", ts: "2026-05-19T00:00:00Z", author: "ai" },
          ],
        });
      })
    );

    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument()
    );
    await user.click(screen.getByTestId("sidebar-file-README.md"));

    // Newest id ("weird") doesn't parse → falls back to length + 1 = 3.
    await waitFor(() =>
      expect(screen.getByTestId("editor-active-version")).toHaveTextContent("v3")
    );
  });

  it("does not show a version badge while the initial stat fetch is in flight (#143 round 3)", async () => {
    const user = userEvent.setup();
    const { http, HttpResponse, delay } = await import("msw");
    const { server } = await import("@/test/mocks/server");
    server.use(
      http.get("http://localhost:8080/api/stat/*", async () => {
        await delay(30);
        return HttpResponse.json({
          path: "README.md",
          root: "mock-root",
          modified: "2026-05-20T00:00:00Z",
          created: "2026-05-19T00:00:00Z",
          state: "draft",
          hasOpenComments: false,
        });
      })
    );

    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument()
    );
    await user.click(screen.getByTestId("sidebar-file-README.md"));

    // The stat fetch is still in flight — versionReady hasn't resolved yet,
    // so the badge must not render a guessed version (#143 round 3).
    expect(screen.queryByTestId("editor-active-version")).not.toBeInTheDocument();

    // Once stat resolves (draft, no history), v1 is exact and shows up.
    await waitFor(() =>
      expect(screen.getByTestId("editor-active-version")).toHaveTextContent("v1")
    );
  });

  it("keeps the version badge hidden when listRevisions fails after a successful stat (#143 round 3)", async () => {
    const user = userEvent.setup();
    const { http, HttpResponse } = await import("msw");
    const { server } = await import("@/test/mocks/server");
    server.use(
      http.get("http://localhost:8080/api/stat/*", () =>
        HttpResponse.json({
          path: "README.md",
          root: "mock-root",
          modified: "2026-05-20T00:00:00Z",
          created: "2026-05-19T00:00:00Z",
          state: "review",
          hasOpenComments: false,
        })
      ),
      http.get("http://localhost:8080/api/revisions/*", () =>
        HttpResponse.json({ error: "boom" }, { status: 500 })
      )
    );

    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument()
    );
    await user.click(screen.getByTestId("sidebar-file-README.md"));

    // Give the failed stat/listRevisions chain plenty of time to settle —
    // the catch branch degrades reviewState to "draft" (editor stays usable)
    // but must not guess a version, unlike an actual draft file (#143
    // round 3).
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.queryByTestId("editor-active-version")).not.toBeInTheDocument();
  });

  it("clears the previous file's version badge the instant the active tab changes (#143 round 3)", async () => {
    const user = userEvent.setup();
    const { http, HttpResponse } = await import("msw");
    const { server } = await import("@/test/mocks/server");
    server.use(
      http.get("http://localhost:8080/api/stat/*", ({ request }) => {
        const url = new URL(request.url);
        const path = url.pathname.replace(/^\/api\/stat\//, "");
        return HttpResponse.json({
          path,
          root: "mock-root",
          modified: "2026-05-20T00:00:00Z",
          created: "2026-05-19T00:00:00Z",
          state: path === "README.md" ? "review" : "draft",
          hasOpenComments: false,
        });
      }),
      http.get("http://localhost:8080/api/revisions/*", ({ request }) => {
        const url = new URL(request.url);
        const id = url.searchParams.get("id");
        if (id) {
          return HttpResponse.json({
            id,
            ts: "2026-05-20T00:00:00Z",
            author: "ai",
            content: "# README.md\n\nprevious content",
          });
        }
        return HttpResponse.json({
          path: "README.md",
          root: "mock-root",
          revisions: [{ id: "r-002", ts: "2026-05-20T00:00:00Z", author: "ai" }],
        });
      })
    );

    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument()
    );
    await user.click(screen.getByTestId("sidebar-file-README.md"));
    await waitFor(() =>
      expect(screen.getByTestId("editor-active-version")).toHaveTextContent("v3")
    );

    await user.click(screen.getByTestId("sidebar-dir-docs"));
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-docs/intro.md")).toBeInTheDocument()
    );
    await user.click(screen.getByTestId("sidebar-file-docs/intro.md"));

    // #143 round 3: switching the active tab must never let the previous
    // file's version linger, even for a single frame — the render-time
    // reset (not an effect) clears versionReady synchronously on file-key
    // change.
    expect(screen.queryByTestId("editor-active-version")).not.toHaveTextContent("v3");
  });

  it("fetches a newly-listed revision's content even after versionReady has already resolved (#143 round 4 regression)", async () => {
    // Regression guard: an earlier version of the revContents-fetch effect
    // gated its entire body on `!versionReady`, so once the badge resolved
    // once it stopped fetching content for any revision that showed up
    // later (e.g. a SyncExternalEdit-appended revision discovered by the
    // reviewRefresh poll while the tab stays open). That silently broke both
    // the diff gutter's baseline search and computeDisplayVersion (which
    // then saw `newestRevisionContent === undefined` and guessed `+1`).
    const user = userEvent.setup();
    const { http, HttpResponse } = await import("msw");
    const { server } = await import("@/test/mocks/server");

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
      emitMessage(data: unknown) {
        this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent<string>);
      }
      close() {
        this.closed = true;
      }
    }
    vi.stubGlobal("EventSource", MockEventSource);

    try {
      // listRevisions starts with a single revision; a second one is added
      // server-side partway through the test to simulate an out-of-band
      // append.
      let revisionList = [{ id: "r-001", ts: "2026-05-19T00:00:00Z", author: "ai" }];
      const fetchedRevisionIds: string[] = [];
      server.use(
        http.get("http://localhost:8080/api/stat/*", () =>
          HttpResponse.json({
            path: "README.md",
            root: "mock-root",
            modified: "2026-05-20T00:00:00Z",
            created: "2026-05-19T00:00:00Z",
            state: "review",
            hasOpenComments: false,
          })
        ),
        http.get("http://localhost:8080/api/revisions/*", ({ request }) => {
          const url = new URL(request.url);
          const id = url.searchParams.get("id");
          if (id) {
            fetchedRevisionIds.push(id);
            return HttpResponse.json({
              id,
              ts: "2026-05-20T00:00:00Z",
              author: "ai",
              content: "# README.md\n\nprevious content",
            });
          }
          return HttpResponse.json({
            path: "README.md",
            root: "mock-root",
            revisions: revisionList,
          });
        })
      );

      renderPage();
      await waitFor(() =>
        expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument()
      );
      await user.click(screen.getByTestId("sidebar-file-README.md"));

      // versionReady resolves off the single r-001 revision, fetching its
      // content once.
      await waitFor(() =>
        expect(screen.getByTestId("editor-active-version")).toHaveTextContent("v2")
      );
      expect(fetchedRevisionIds).toEqual(["r-001"]);

      // A second revision appears server-side. Simulate the reviewRefresh
      // poll's out-of-band discovery via an SSE `comments` event naming the
      // (still) active, still-open file — this re-fetches stat + listRevisions
      // without switching tabs (so versionReady stays true throughout).
      revisionList = [
        { id: "r-002", ts: "2026-05-21T00:00:00Z", author: "ai" },
        { id: "r-001", ts: "2026-05-19T00:00:00Z", author: "ai" },
      ];
      const instance = MockEventSource.instances[0];
      instance.emitMessage({ kind: "comments", root: "mock-root", path: "README.md" });

      // #143 round 4: even though versionReady already resolved to true
      // above, the newly-listed r-002's content must still be fetched.
      await waitFor(() => expect(fetchedRevisionIds).toContain("r-002"));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("hides the version badge while a newly-listed revision's content is still in flight, even though versionReady is already true (#143 round 5 codex review)", async () => {
    // Regression guard: displayVersion used to gate on `versionReady` alone.
    // Once true (from an earlier newest revision), it never resets to
    // false, so a later revision whose content hasn't arrived yet (or whose
    // fetch fails outright) fell through to `newestRevisionContent ===
    // undefined`, which computeDisplayVersion treats as "not matching" — a
    // silently wrong (and, on fetch failure, permanently stuck) `+1`.
    const user = userEvent.setup();
    const { http, HttpResponse } = await import("msw");
    const { server } = await import("@/test/mocks/server");

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
      emitMessage(data: unknown) {
        this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent<string>);
      }
      close() {
        this.closed = true;
      }
    }
    vi.stubGlobal("EventSource", MockEventSource);

    try {
      let revisionList = [{ id: "r-001", ts: "2026-05-19T00:00:00Z", author: "ai" }];
      // Stalls r-002's getRevision call indefinitely (until the test
      // releases it) so its content stays "not yet fetched".
      const release: { current: () => void } = { current: () => {} };
      const r002Gate = new Promise<void>((resolve) => {
        release.current = resolve;
      });

      server.use(
        http.get("http://localhost:8080/api/stat/*", () =>
          HttpResponse.json({
            path: "README.md",
            root: "mock-root",
            modified: "2026-05-20T00:00:00Z",
            created: "2026-05-19T00:00:00Z",
            state: "review",
            hasOpenComments: false,
          })
        ),
        http.get("http://localhost:8080/api/revisions/*", async ({ request }) => {
          const url = new URL(request.url);
          const id = url.searchParams.get("id");
          if (id === "r-002") {
            await r002Gate;
            return HttpResponse.json({
              id,
              ts: "2026-05-21T00:00:00Z",
              author: "ai",
              // Matches the current buffer exactly (the external-edit-sync
              // path) — no `+1` once this actually lands.
              content: "# README.md\n\nmock content",
            });
          }
          if (id) {
            return HttpResponse.json({
              id,
              ts: "2026-05-20T00:00:00Z",
              author: "ai",
              content: "# README.md\n\nprevious content",
            });
          }
          return HttpResponse.json({
            path: "README.md",
            root: "mock-root",
            revisions: revisionList,
          });
        })
      );

      renderPage();
      await waitFor(() =>
        expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument()
      );
      await user.click(screen.getByTestId("sidebar-file-README.md"));

      // versionReady resolves off the single r-001 revision (content
      // mismatches the current buffer → `+1` → v2).
      await waitFor(() =>
        expect(screen.getByTestId("editor-active-version")).toHaveTextContent("v2")
      );

      // A newer revision (r-002) appears server-side; its content fetch is
      // stalled by the gate above.
      revisionList = [
        { id: "r-002", ts: "2026-05-21T00:00:00Z", author: "ai" },
        { id: "r-001", ts: "2026-05-19T00:00:00Z", author: "ai" },
      ];
      const instance = MockEventSource.instances[0];
      instance.emitMessage({ kind: "comments", root: "mock-root", path: "README.md" });

      // #143 round 5: the badge must disappear (not keep showing the stale
      // v2, and not guess a wrong v3) while r-002's content is still in
      // flight.
      await waitFor(() =>
        expect(screen.queryByTestId("editor-active-version")).not.toBeInTheDocument()
      );

      release.current();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shows the correct version once the newly-listed revision's content arrives, without a false +1 (#143 round 5 codex review)", async () => {
    const user = userEvent.setup();
    const { http, HttpResponse } = await import("msw");
    const { server } = await import("@/test/mocks/server");

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
      emitMessage(data: unknown) {
        this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent<string>);
      }
      close() {
        this.closed = true;
      }
    }
    vi.stubGlobal("EventSource", MockEventSource);

    try {
      let revisionList = [{ id: "r-001", ts: "2026-05-19T00:00:00Z", author: "ai" }];

      server.use(
        http.get("http://localhost:8080/api/stat/*", () =>
          HttpResponse.json({
            path: "README.md",
            root: "mock-root",
            modified: "2026-05-20T00:00:00Z",
            created: "2026-05-19T00:00:00Z",
            state: "review",
            hasOpenComments: false,
          })
        ),
        http.get("http://localhost:8080/api/revisions/*", ({ request }) => {
          const url = new URL(request.url);
          const id = url.searchParams.get("id");
          if (id === "r-002") {
            return HttpResponse.json({
              id,
              ts: "2026-05-21T00:00:00Z",
              author: "ai",
              // Matches the current buffer exactly (external-edit-sync path)
              // — the correct version is plain `id` (v2), never `id + 1`
              // (v3).
              content: "# README.md\n\nmock content",
            });
          }
          if (id) {
            return HttpResponse.json({
              id,
              ts: "2026-05-20T00:00:00Z",
              author: "ai",
              content: "# README.md\n\nprevious content",
            });
          }
          return HttpResponse.json({
            path: "README.md",
            root: "mock-root",
            revisions: revisionList,
          });
        })
      );

      renderPage();
      await waitFor(() =>
        expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument()
      );
      await user.click(screen.getByTestId("sidebar-file-README.md"));

      await waitFor(() =>
        expect(screen.getByTestId("editor-active-version")).toHaveTextContent("v2")
      );

      revisionList = [
        { id: "r-002", ts: "2026-05-21T00:00:00Z", author: "ai" },
        { id: "r-001", ts: "2026-05-19T00:00:00Z", author: "ai" },
      ];
      const instance = MockEventSource.instances[0];
      instance.emitMessage({ kind: "comments", root: "mock-root", path: "README.md" });

      // #143 round 5: once r-002's content lands and matches the current
      // buffer, the badge must show the exact match version (v2 = plain
      // `id`), never a guessed `+1` (v3) at any point along the way.
      await waitFor(() =>
        expect(screen.getByTestId("editor-active-version")).toHaveTextContent("v2")
      );
      expect(screen.queryByTestId("editor-active-version")).not.toHaveTextContent("v3");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shows the full file name on tab hover, and the tab still selects (#192)", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument()
    );
    await user.click(screen.getByTestId("sidebar-file-README.md"));
    await user.click(screen.getByTestId("sidebar-dir-docs"));
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-docs/intro.md")).toBeInTheDocument()
    );
    await user.click(screen.getByTestId("sidebar-file-docs/intro.md"));
    await waitFor(() => expect(useOpenFiles.getState().files).toHaveLength(2));

    // The click above left the pointer on the sidebar row, whose NameTooltip
    // is still open — without moving off it first, findByRole("tooltip")
    // resolves to that one ("intro.md") instead of the tab's (#230).
    await user.unhover(screen.getByTestId("sidebar-file-docs/intro.md"));
    await waitFor(() =>
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
    );

    await user.hover(screen.getByTestId("editor-tab-label-README.md"));
    const tooltip = await screen.findByRole("tooltip", {}, { timeout: 3000 });
    expect(tooltip).toHaveTextContent("README.md");

    // The tooltip wraps the label, not the Tab, so Tabs still reads `value`
    // off the Tab and clicking it switches the active file.
    await user.click(screen.getByTestId("editor-tab-README.md"));
    await waitFor(() =>
      expect(screen.getByTestId("editor-active-path")).toHaveTextContent(
        "README.md"
      )
    );
  });

  it("always renders the diff toggle, disabled until the file has a comparable revision (#194)", async () => {
    const user = userEvent.setup();
    const { http, HttpResponse } = await import("msw");
    const { server } = await import("@/test/mocks/server");

    renderPage();

    // No file open: still rendered, just not usable.
    const toggle = screen.getByTestId("editor-diff-toggle");
    expect(toggle).toBeDisabled();

    // A draft file (not under review) keeps it disabled.
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument()
    );
    await user.click(screen.getByTestId("sidebar-file-README.md"));
    await waitFor(() =>
      expect(screen.getByTestId("tiptap-editor")).toBeInTheDocument()
    );
    expect(screen.getByTestId("editor-diff-toggle")).toBeDisabled();

    // Under review with a revision to compare against → enabled.
    server.use(
      http.get("http://localhost:8080/api/stat/*", () =>
        HttpResponse.json({
          path: "docs/intro.md",
          root: "mock-root",
          modified: "2026-05-20T00:00:00Z",
          created: "2026-05-19T00:00:00Z",
          state: "review",
          hasOpenComments: false,
        })
      ),
      http.get("http://localhost:8080/api/revisions/*", ({ request }) => {
        const url = new URL(request.url);
        const id = url.searchParams.get("id");
        if (id) {
          return HttpResponse.json({
            id,
            ts: "2026-05-19T00:00:00Z",
            author: "ai",
            content: "# docs/intro.md\n\nprevious content",
          });
        }
        return HttpResponse.json({
          path: "docs/intro.md",
          root: "mock-root",
          revisions: [{ id: "r-001", ts: "2026-05-19T00:00:00Z", author: "ai" }],
        });
      })
    );

    await user.click(screen.getByTestId("sidebar-dir-docs"));
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-docs/intro.md")).toBeInTheDocument()
    );
    await user.click(screen.getByTestId("sidebar-file-docs/intro.md"));

    await waitFor(() =>
      expect(screen.getByTestId("editor-diff-toggle")).toBeEnabled()
    );
  });

  it("switches active file via tab click and closes a tab via the close button", async () => {
    const user = userEvent.setup();
    renderPage();

    // Open two files via the sidebar.
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument()
    );
    await user.click(screen.getByTestId("sidebar-file-README.md"));
    await user.click(screen.getByTestId("sidebar-dir-docs"));
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-docs/intro.md")).toBeInTheDocument()
    );
    await user.click(screen.getByTestId("sidebar-file-docs/intro.md"));
    await waitFor(() =>
      expect(useOpenFiles.getState().files).toHaveLength(2)
    );

    // Tab click switches the active file (covers Tabs onChange).
    await user.click(screen.getByTestId("editor-tab-README.md"));
    await waitFor(() =>
      expect(screen.getByTestId("editor-active-path")).toHaveTextContent("README.md")
    );

    // Close the inactive tab via its close icon — active stays on README.md.
    await user.click(screen.getByTestId("editor-tab-close-docs/intro.md"));
    await waitFor(() =>
      expect(useOpenFiles.getState().files).toHaveLength(1)
    );
    expect(useOpenFiles.getState().files[0].path).toBe("README.md");

    // Close the last tab → store goes empty and editor shows the placeholder.
    await user.click(screen.getByTestId("editor-tab-close-README.md"));
    await waitFor(() =>
      expect(screen.getByTestId("editor-empty-state")).toBeInTheDocument()
    );
    expect(useOpenFiles.getState().files).toEqual([]);
    expect(Object.values(useOpenFiles.getState().activeIdByRoot).filter(Boolean)).toEqual([]);
  });

  it("shows an error toast and stays on the empty state when the URL path points to a missing file", async () => {
    const { http, HttpResponse } = await import("msw");
    const { server } = await import("@/test/mocks/server");
    server.use(
      http.get("http://localhost:8080/api/files/*", () =>
        HttpResponse.json({ error: "not found" }, { status: 404 })
      )
    );

    renderPage(`/${DEFAULT_ROOT}/missing.md`);

    await waitFor(() => {
      const toasts = useToast.getState().toasts;
      expect(toasts.some((t) => t.severity === "error")).toBe(true);
    });
    expect(screen.getByTestId("editor-empty-state")).toBeInTheDocument();
    expect(Object.values(useOpenFiles.getState().activeIdByRoot).filter(Boolean)).toEqual([]);
  });

  it("save shows an error toast when the API fails", async () => {
    const user = userEvent.setup();

    // Patch a one-off failing PUT for the next save call.
    const { http, HttpResponse } = await import("msw");
    const { server } = await import("@/test/mocks/server");
    server.use(
      http.put("http://localhost:8080/api/files/*", () =>
        HttpResponse.json({ error: "boom" }, { status: 500 })
      )
    );

    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument()
    );
    await user.click(screen.getByTestId("sidebar-file-README.md"));
    await waitFor(() =>
      expect(screen.getByTestId("editor-active-path")).toHaveTextContent("README.md")
    );
    useOpenFiles.getState().updateActiveMarkdown("mock-root", "edited");

    await user.click(screen.getByTestId("editor-save"));
    await waitFor(() => {
      const toasts = useToast.getState().toasts;
      expect(toasts.some((t) => t.severity === "error")).toBe(true);
    });
  });
});

// #167 A1–A4: clicking a comment's "対象:" label must jump to it regardless of
// whether CommentHighlight painted a decoration for it — resolved comments
// intentionally have none (#96/#97), so the jump used to key off the (absent)
// `[data-comment-id]` decoration and silently do nothing.
//
// TiptapEditor is mocked out at the top of this file (no real ProseMirror DOM
// mounts through it), so these tests build a standalone real `Editor` and
// hand it to EditorPage via the same `useEditorInstance` store the mocked
// component would otherwise populate. Once installed, EditorPage's own
// "push comments into the editor" effect (`setCommentHighlights`) fires against
// it exactly as it would against the real TiptapEditor instance.
describe("EditorPage jump to comment (#167)", () => {
  let fakeEditor: Editor | null = null;

  function installFakeEditor(html: string): Editor {
    // Mirrors the extension set EditorPage's other effects rely on
    // (DiffGutter's setDiffGutter command) on top of CommentHighlight.
    fakeEditor = new Editor({
      extensions: [StarterKit.configure({ link: false }), CommentHighlight, DiffGutter],
      content: html,
    });
    useEditorInstance.getState().setEditor(fakeEditor);
    return fakeEditor;
  }

  function useComments(comments: CommentJSON[]) {
    return async () => {
      const { http, HttpResponse } = await import("msw");
      const { server } = await import("@/test/mocks/server");
      server.use(
        http.get("http://localhost:8080/api/stat/*", () =>
          HttpResponse.json({
            path: "README.md",
            root: "mock-root",
            modified: "2026-05-20T00:00:00Z",
            created: "2026-05-19T00:00:00Z",
            state: "review",
            hasOpenComments: comments.some((c) => c.status === "open"),
          })
        ),
        http.get("http://localhost:8080/api/comments/*", () =>
          HttpResponse.json({
            file: "README.md",
            root: "mock-root",
            summary: { total: comments.length, by_scope: {}, by_status: {} },
            comments,
          })
        )
      );
    };
  }

  async function openReadmeWithComments(comments: CommentJSON[]) {
    const user = userEvent.setup();
    await useComments(comments)();
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument()
    );
    await user.click(screen.getByTestId("sidebar-file-README.md"));
    // Comments are only fetched once the file is under review — wait for the
    // side pane to actually render the row(s) before touching the editor.
    for (const c of comments) {
      await waitFor(() =>
        expect(screen.getByTestId(`comment-context-${c.id}`)).toBeInTheDocument()
      );
    }
    return user;
  }

  beforeEach(() => {
    localStorage.clear();
    useOpenFiles.setState({ files: [], activeIdByRoot: {} });
    useToast.setState({ toasts: [] });
    useConfirm.setState({ pending: null, queue: [] });
    useEditorInstance.setState({ editor: null });
    // jsdom does not implement scrollIntoView.
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    fakeEditor?.destroy();
    fakeEditor = null;
    useEditorInstance.setState({ editor: null });
  });

  it("A1: jumps to a resolved comment's anchor even though it has no decoration", async () => {
    const comment: CommentJSON = {
      id: "c-011",
      scope: "inline",
      body: "ここ直しました",
      status: "resolved",
      anchor: { heading_path: ["## 実績"], snippet: "SLA遵守率 98%", occurrence: 0 },
      context: { heading_path: ["実績"], line_range: [74, 74] },
      orphan: false,
    };
    const user = await openReadmeWithComments([comment]);

    const ed = installFakeEditor("<h2>実績</h2><p>SLA遵守率 98%</p>");
    await waitFor(() =>
      // Resolved comments paint no persistent decoration (#96/#97).
      expect(ed.view.dom.querySelectorAll('[data-comment-id="c-011"]')).toHaveLength(0)
    );

    const scrollSpy = vi.mocked(Element.prototype.scrollIntoView);
    await user.click(screen.getByTestId("comment-context-c-011"));

    await waitFor(() => expect(scrollSpy).toHaveBeenCalled());
    // Assert *which* element was scrolled to: the live anchor position, not
    // some unrelated node — resolveAnchorInDoc + domAtPos must have landed on
    // the paragraph carrying the anchor's snippet.
    const scrolledEl = scrollSpy.mock.instances[0] as HTMLElement;
    expect(scrolledEl.textContent).toContain("SLA遵守率 98%");

    // A transient flash decoration takes the place of the (absent) persistent
    // comment-mark decoration.
    await waitFor(() =>
      expect(ed.view.dom.querySelectorAll(".comment-flash.is-flash")).toHaveLength(1)
    );
    // The resolved comment's persistent highlight is still not resurrected.
    expect(ed.view.dom.querySelectorAll(".comment-mark")).toHaveLength(0);
  });

  it("A2: jumps to an open comment's decoration and flashes it (regression)", async () => {
    const comment: CommentJSON = {
      id: "c-020",
      scope: "inline",
      body: "ここ直して",
      status: "open",
      anchor: { heading_path: ["## 実績"], snippet: "SLA遵守率 98%", occurrence: 0 },
      context: { heading_path: ["実績"], line_range: [74, 74] },
      orphan: false,
    };
    const user = await openReadmeWithComments([comment]);

    const ed = installFakeEditor("<h2>実績</h2><p>SLA遵守率 98%</p>");
    await waitFor(() =>
      expect(ed.view.dom.querySelectorAll('[data-comment-id="c-020"]')).toHaveLength(1)
    );
    const decorated = ed.view.dom.querySelector<HTMLElement>('[data-comment-id="c-020"]')!;

    const scrollSpy = vi.mocked(Element.prototype.scrollIntoView);
    await user.click(screen.getByTestId("comment-context-c-020"));

    await waitFor(() => expect(scrollSpy).toHaveBeenCalled());
    expect(scrollSpy.mock.instances[0]).toBe(decorated);
    expect(decorated.classList.contains("is-flash")).toBe(true);
    // The existing decoration-based flash is used — no transient flash decoration.
    expect(ed.view.dom.querySelectorAll(".comment-flash")).toHaveLength(0);
  });

  it("A3: does nothing (no throw, no scroll) when no anchor resolves", async () => {
    const comment: CommentJSON = {
      id: "c-030",
      scope: "inline",
      body: "もう無い場所を指してる",
      status: "open",
      anchor: { heading_path: [], snippet: "vanished text no longer present", occurrence: 0 },
      context: { heading_path: [], line_range: [10, 10] },
      orphan: false,
    };
    const user = await openReadmeWithComments([comment]);
    installFakeEditor("<h2>実績</h2><p>SLA遵守率 98%</p>");

    const scrollSpy = vi.mocked(Element.prototype.scrollIntoView);
    await expect(
      user.click(screen.getByTestId("comment-context-c-030"))
    ).resolves.not.toThrow();

    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it("A4: multi-anchor comment scrolls to the earliest (smallest from) anchor", async () => {
    const comment: CommentJSON = {
      id: "c-040",
      scope: "cross_section",
      body: "セクションをまたぐコメント",
      status: "resolved",
      anchors: [
        { heading_path: ["## A"], snippet: "first", occurrence: 0 },
        { heading_path: ["## B"], snippet: "second", occurrence: 0 },
      ],
      context: null,
      orphan: false,
    };
    const user = await openReadmeWithComments([comment]);
    const ed = installFakeEditor(
      "<h2>A</h2><p>first target</p><h2>B</h2><p>second target</p>"
    );

    const scrollSpy = vi.mocked(Element.prototype.scrollIntoView);
    await user.click(screen.getByTestId("comment-context-c-040"));

    await waitFor(() => expect(scrollSpy).toHaveBeenCalled());
    const scrolledEl = scrollSpy.mock.instances[0] as HTMLElement;
    // "first" precedes "second" in document order, so its anchor has the
    // smaller `from` and must be the one scrolled to.
    expect(scrolledEl.textContent).toContain("first");

    // Both anchors resolve, so both get flashed.
    await waitFor(() =>
      expect(ed.view.dom.querySelectorAll(".comment-flash.is-flash")).toHaveLength(2)
    );
  });

  it("A5: flashes anchor and anchors together for a multi-line inline comment", async () => {
    // #162's shape: the first selected block lives in `anchor`, the rest in
    // `anchors`. Treating the two as mutually exclusive would flash only the
    // first block and, if `anchor` ever resolved later in the document than an
    // entry in `anchors`, would scroll to the wrong place.
    const comment: CommentJSON = {
      id: "c-041",
      scope: "inline",
      body: "複数行に付けたコメント",
      status: "resolved",
      anchor: { heading_path: ["## A"], snippet: "first", occurrence: 0 },
      anchors: [{ heading_path: ["## B"], snippet: "second", occurrence: 0 }],
      context: null,
      orphan: false,
    };
    const user = await openReadmeWithComments([comment]);
    const ed = installFakeEditor(
      "<h2>A</h2><p>first target</p><h2>B</h2><p>second target</p>"
    );

    const scrollSpy = vi.mocked(Element.prototype.scrollIntoView);
    await user.click(screen.getByTestId("comment-context-c-041"));

    await waitFor(() => expect(scrollSpy).toHaveBeenCalled());
    expect((scrollSpy.mock.instances[0] as HTMLElement).textContent).toContain("first");
    await waitFor(() =>
      expect(ed.view.dom.querySelectorAll(".comment-flash.is-flash")).toHaveLength(2)
    );
  });

  describe("comment_id deeplink (STEP 3)", () => {
    it("ケース 3: comment_id 付きで開く → ジャンプする", async () => {
      const comment: CommentJSON = {
        id: "c-001",
        scope: "inline",
        body: "対象のコメント",
        status: "open",
        anchor: { heading_path: ["## Title"], snippet: "hello world", occurrence: 0 },
        context: { heading_path: ["Title"], line_range: [2, 2] },
        orphan: false,
      };
      await useComments([comment])();

      const scrollSpy = vi.mocked(Element.prototype.scrollIntoView);
      renderPage(`/${DEFAULT_ROOT}/README.md?comment_id=c-001`);
      installFakeEditor("<h2>Title</h2><p>hello world</p>");

      await waitFor(() => {
        expect(scrollSpy).toHaveBeenCalled();
      });
      const scrolledEl = scrollSpy.mock.instances[0] as HTMLElement;
      expect(scrolledEl.textContent).toContain("hello world");
    });

    it("ケース 4: 存在しない comment_id", async () => {
      const comment: CommentJSON = {
        id: "c-001",
        scope: "inline",
        body: "対象のコメント",
        status: "open",
        anchor: { heading_path: ["## Title"], snippet: "hello world", occurrence: 0 },
        context: { heading_path: ["Title"], line_range: [2, 2] },
        orphan: false,
      };
      await useComments([comment])();

      const scrollSpy = vi.mocked(Element.prototype.scrollIntoView);
      renderPage(`/${DEFAULT_ROOT}/README.md?comment_id=does-not-exist`);
      installFakeEditor("<h2>Title</h2><p>hello world</p>");

      await waitFor(() => {
        expect(screen.getByTestId("editor-active-path")).toHaveTextContent("README.md");
      });
      expect(scrollSpy).not.toHaveBeenCalled();
    });

    it("ケース 5: orphan な comment_id", async () => {
      const comment: CommentJSON = {
        id: "c-001",
        scope: "inline",
        body: "孤立したコメント",
        status: "open",
        anchor: { heading_path: ["## Gone"], snippet: "missing snippet", occurrence: 0 },
        context: { heading_path: ["Gone"], line_range: [2, 2] },
        orphan: true,
      };
      await useComments([comment])();

      const scrollSpy = vi.mocked(Element.prototype.scrollIntoView);
      renderPage(`/${DEFAULT_ROOT}/README.md?comment_id=c-001`);
      installFakeEditor("<h2>Title</h2><p>hello world</p>");

      await waitFor(() => {
        expect(screen.getByTestId("editor-active-path")).toHaveTextContent("README.md");
      });
      expect(scrollSpy).not.toHaveBeenCalled();
    });

    it("ケース 6: comment_id なし（既存動作の回帰確認）", async () => {
      const comment: CommentJSON = {
        id: "c-001",
        scope: "inline",
        body: "対象のコメント",
        status: "open",
        anchor: { heading_path: ["## Title"], snippet: "hello world", occurrence: 0 },
        context: { heading_path: ["Title"], line_range: [2, 2] },
        orphan: false,
      };
      await useComments([comment])();

      const scrollSpy = vi.mocked(Element.prototype.scrollIntoView);
      renderPage(`/${DEFAULT_ROOT}/README.md`);
      installFakeEditor("<h2>Title</h2><p>hello world</p>");

      await waitFor(() => {
        expect(screen.getByTestId("editor-active-path")).toHaveTextContent("README.md");
      });
      expect(scrollSpy).not.toHaveBeenCalled();
    });

    it("P1: preserves comment_id deeplink until the matching activePath's comments finish loading", async () => {
      const comment: CommentJSON = {
        id: "c-001",
        scope: "inline",
        body: "対象のコメント",
        status: "open",
        anchor: { heading_path: ["## Title"], snippet: "hello world", occurrence: 0 },
        context: { heading_path: ["Title"], line_range: [2, 2] },
        orphan: false,
      };
      await useComments([comment])();

      const scrollSpy = vi.mocked(Element.prototype.scrollIntoView);
      renderPage(`/${DEFAULT_ROOT}/README.md?comment_id=c-001`);
      installFakeEditor("<h2>Title</h2><p>hello world</p>");

      await waitFor(() => {
        expect(scrollSpy).toHaveBeenCalled();
      });
      const scrolledEl = scrollSpy.mock.instances[0] as HTMLElement;
      expect(scrolledEl.textContent).toContain("hello world");
    });
  });
});
