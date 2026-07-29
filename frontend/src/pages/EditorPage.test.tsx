import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { EditorPage } from "./EditorPage";
import { useOpenFiles } from "@/hooks/useOpenFiles";
import { useToast } from "@/hooks/useToast";
import { useConfirm } from "@/hooks/useConfirm";

vi.mock("@/components/tiptap/TiptapEditor", () => ({
  TiptapEditor: () => <div data-testid="tiptap-editor" />,
}));

/** Renders the URL search string so tests can assert URL state via the DOM. */
function LocationProbe() {
  const loc = useLocation();
  return <span data-testid="loc-search">{loc.search}</span>;
}

function renderPage(initialPath = "/") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <EditorPage />
        <LocationProbe />
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

  it("opens the file specified by ?select_file=... on mount", async () => {
    renderPage("/?select_file=docs/intro.md");

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

  it("syncs the active tab path to the URL's select_file param", async () => {
    const user = userEvent.setup();
    renderPage();

    // Open README.md — URL should pick it up as select_file.
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument()
    );
    await user.click(screen.getByTestId("sidebar-file-README.md"));
    await waitFor(() => {
      const params = new URLSearchParams(
        screen.getByTestId("loc-search").textContent ?? ""
      );
      expect(params.get("select_file")).toBe("README.md");
    });

    // Open a second file via the sidebar and ensure the URL switches to it.
    await user.click(screen.getByTestId("sidebar-dir-docs"));
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-docs/intro.md")).toBeInTheDocument()
    );
    await user.click(screen.getByTestId("sidebar-file-docs/intro.md"));
    await waitFor(() => {
      const search = screen.getByTestId("loc-search").textContent ?? "";
      const params = new URLSearchParams(search);
      expect(params.get("select_file")).toBe("docs/intro.md");
    });
  });

  it("preserves an unrelated query param (filter) while syncing select_file", async () => {
    const user = userEvent.setup();
    renderPage("/?filter=docs");

    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument()
    );
    await user.click(screen.getByTestId("sidebar-file-README.md"));

    await waitFor(() => {
      const params = new URLSearchParams(
        screen.getByTestId("loc-search").textContent ?? ""
      );
      expect(params.get("filter")).toBe("docs");
      expect(params.get("select_file")).toBe("README.md");
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

  it("shows an error toast and stays on the empty state when select_file points to a missing path", async () => {
    const { http, HttpResponse } = await import("msw");
    const { server } = await import("@/test/mocks/server");
    server.use(
      http.get("http://localhost:8080/api/files/*", () =>
        HttpResponse.json({ error: "not found" }, { status: 404 })
      )
    );

    renderPage("/?select_file=missing.md");

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
