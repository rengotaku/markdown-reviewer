import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { EditorPage } from "./EditorPage";
import { useOpenFiles, type OpenFile } from "@/hooks/useOpenFiles";
import { useToast } from "@/hooks/useToast";
import { useConfirm } from "@/hooks/useConfirm";

vi.mock("@/components/tiptap/TiptapEditor", () => ({
  TiptapEditor: () => <div data-testid="tiptap-editor" />,
}));

function makeOpenFile(
  overrides: Partial<OpenFile> & { id: string; path: string }
): OpenFile {
  return {
    name: overrides.path,
    root: "mock-root",
    markdown: "# body",
    savedMarkdown: "# body",
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
 * #245: several markdown-reviewer browser tabs are indistinguishable while
 * they all say "markdown-reviewer". The browser tab title has to follow the
 * editor tab that is actually on screen.
 */
describe("EditorPage browser tab title (#245)", () => {
  beforeEach(() => {
    localStorage.clear();
    document.title = "markdown-reviewer";
    useOpenFiles.setState({ files: [], activeIdByRoot: {} });
    useToast.setState({ toasts: [] });
    useConfirm.setState({ pending: null, queue: [] });
  });

  it("names the active tab, and switches with it", async () => {
    useOpenFiles.setState({
      files: [
        makeOpenFile({ id: "a", path: "README.md" }),
        makeOpenFile({ id: "b", path: "CHANGELOG.md" }),
      ],
      activeIdByRoot: { "mock-root": "a" },
    });

    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("editor-active-path")).toHaveTextContent("README.md")
    );
    expect(document.title).toBe("README.md — markdown-reviewer");

    act(() => useOpenFiles.getState().setActive("mock-root", "b"));
    await waitFor(() =>
      expect(document.title).toBe("CHANGELOG.md — markdown-reviewer")
    );
  });

  it("marks an unsaved tab with the same bullet the editor tab uses", async () => {
    useOpenFiles.setState({
      files: [makeOpenFile({ id: "a", path: "README.md", isDirty: true })],
      activeIdByRoot: { "mock-root": "a" },
    });

    renderPage();
    await waitFor(() =>
      expect(document.title).toBe("README.md • — markdown-reviewer")
    );
  });

  it("falls back to the bare app name with no file open", async () => {
    document.title = "leftover.md — markdown-reviewer";
    renderPage();
    await waitFor(() => expect(document.title).toBe("markdown-reviewer"));
  });
});
