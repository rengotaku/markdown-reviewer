import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EditorPage } from "./EditorPage";
import { useOpenFiles } from "@/hooks/useOpenFiles";
import { useToast } from "@/hooks/useToast";
import { useConfirm } from "@/hooks/useConfirm";

vi.mock("@/components/tiptap/TiptapEditor", () => ({
  TiptapEditor: () => <div data-testid="tiptap-editor" />,
}));

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <EditorPage />
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

  it("renders the TiptapEditor inside the layout", () => {
    renderPage();
    expect(screen.getByTestId("tiptap-editor")).toBeInTheDocument();
  });

  it("shows the file tree once /api/files resolves", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument()
    );
  });

  it("opens a server file when clicked and shows its path in the header", async () => {
    const user = userEvent.setup();
    renderPage();

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

    // Attempt to switch to a different file
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
});
