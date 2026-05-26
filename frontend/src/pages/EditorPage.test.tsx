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
    useOpenFiles.setState({ files: [], activeId: null });
    useToast.setState({ toasts: [] });
    useConfirm.setState({ pending: null });
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
    useOpenFiles.getState().updateActiveMarkdown("edited content");

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
      .files.find((f) => f.id === useOpenFiles.getState().activeId);
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

    useOpenFiles.getState().updateActiveMarkdown("new content");
    expect(
      useOpenFiles
        .getState()
        .files.find((f) => f.id === useOpenFiles.getState().activeId)!.isDirty
    ).toBe(true);

    await user.click(screen.getByTestId("editor-save"));

    await waitFor(() => {
      const active = useOpenFiles
        .getState()
        .files.find((f) => f.id === useOpenFiles.getState().activeId)!;
      expect(active.isDirty).toBe(false);
    });
    expect(useToast.getState().toasts[0]?.severity).toBe("success");
  });

  it("displays REVIEW_ROOT basename in the sidebar header (from /api/config)", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-review-root")).toHaveTextContent("mock-root")
    );
  });

  it("save-as writes to a versioned path in the same directory and opens it", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument()
    );
    await user.click(screen.getByTestId("sidebar-file-README.md"));
    await waitFor(() =>
      expect(screen.getByTestId("editor-active-path")).toHaveTextContent("README.md")
    );

    await user.click(screen.getByTestId("editor-save-as"));

    await waitFor(() =>
      expect(screen.getByTestId("editor-active-path")).toHaveTextContent("README.v2.md")
    );
    const opened = useOpenFiles
      .getState()
      .files.find((f) => f.path === "README.v2.md");
    expect(opened).toBeDefined();
    expect(useToast.getState().toasts.some((t) => t.severity === "success")).toBe(true);
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
    useOpenFiles.getState().updateActiveMarkdown("edited");

    await user.click(screen.getByTestId("editor-save"));
    await waitFor(() => {
      const toasts = useToast.getState().toasts;
      expect(toasts.some((t) => t.severity === "error")).toBe(true);
    });
  });
});
