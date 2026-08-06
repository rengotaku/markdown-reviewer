import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import { EditorPage } from "./EditorPage";
import { useOpenFiles } from "@/hooks/useOpenFiles";
import { useChangedPaths } from "@/hooks/useChangedPaths";
import { useToast } from "@/hooks/useToast";
import { useConfirm } from "@/hooks/useConfirm";

const API_BASE = "http://localhost:8080";

vi.mock("@/components/tiptap/TiptapEditor", () => ({
  TiptapEditor: () => <div data-testid="tiptap-editor" />,
}));

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
 * #178: dir-change toasts were replaced with a passive "unread" mark
 * (useChangedPaths) surfaced as a sidebar dot. This exercises the two
 * clearing paths that live in EditorPage — opening a file via the sidebar,
 * and a successful save — plus the self-write echo suppression that keeps a
 * save from lighting up its own dot the moment the tree next re-polls.
 */
describe("EditorPage changed-paths integration (#178)", () => {
  beforeEach(() => {
    localStorage.clear();
    useOpenFiles.setState({ files: [], activeIdByRoot: {} });
    useChangedPaths.setState({ changed: new Set(), selfWrites: new Set() });
    useToast.setState({ toasts: [] });
    useConfirm.setState({ pending: null, queue: [] });
  });

  it("clears the mark on open and on save, and does not re-mark from the save's own dir-diff echo", async () => {
    const user = userEvent.setup();

    let dirModified = "2026-05-18T00:00:00Z";
    server.use(
      http.get(`${API_BASE}/api/dirs`, ({ request }) => {
        const url = new URL(request.url);
        const path = url.searchParams.get("path") ?? "";
        if (path !== "") {
          return HttpResponse.json({ root: "mock-root", entries: [] });
        }
        return HttpResponse.json({
          root: "mock-root",
          entries: [
            {
              name: "README.md",
              path: "README.md",
              type: "file",
              modified: dirModified,
            },
          ],
        });
      }),
      http.get(`${API_BASE}/api/files/*`, () =>
        HttpResponse.json({
          path: "README.md",
          root: "mock-root",
          content: "# README.md\n\nmock content",
          modified: "2026-05-20T00:00:00Z",
          created: "2026-05-19T00:00:00Z",
          state: "draft",
          sha: "sha-current",
        })
      ),
      http.put(`${API_BASE}/api/files/*`, async ({ request }) => {
        const body = (await request.json()) as { content: string };
        return HttpResponse.json({
          path: "README.md",
          root: "mock-root",
          content: body.content,
          modified: "2026-05-22T00:00:00Z",
          created: "2026-05-19T00:00:00Z",
          state: "draft",
          sha: "sha-new",
        });
      })
    );

    const client = renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument()
    );

    // Simulate an external change having already armed the dot before the
    // user opens the file.
    useChangedPaths.getState().mark("mock-root", "README.md");
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-changed-dot-README.md")).toBeInTheDocument()
    );

    await user.click(screen.getByTestId("sidebar-file-README.md"));
    await waitFor(() =>
      expect(screen.getByTestId("editor-active-path")).toHaveTextContent("README.md")
    );
    // Opening the file (handleSelect) must have cleared the mark already.
    expect(useChangedPaths.getState().isChanged("mock-root", "README.md")).toBe(false);
    expect(
      screen.queryByTestId("sidebar-changed-dot-README.md")
    ).not.toBeInTheDocument();

    useOpenFiles.getState().updateActiveMarkdown("mock-root", "edited content");
    await user.click(screen.getByTestId("editor-save"));

    await waitFor(() => {
      const active = useOpenFiles
        .getState()
        .files.find((f) => f.id === useOpenFiles.getState().activeIdByRoot["mock-root"])!;
      expect(active.serverSha).toBe("sha-new");
    });
    expect(useChangedPaths.getState().isChanged("mock-root", "README.md")).toBe(false);

    // The directory listing catches up to the save's own mtime next — this
    // is the save's echo and must not re-mark the file.
    dirModified = "2026-05-22T00:00:00Z";
    await client.refetchQueries({ queryKey: ["dir"] });
    await new Promise((r) => setTimeout(r, 30));

    expect(useChangedPaths.getState().isChanged("mock-root", "README.md")).toBe(false);
    expect(
      screen.queryByTestId("sidebar-changed-dot-README.md")
    ).not.toBeInTheDocument();
  });

  // #178 round 2 (codex review, must-fix): handleSelect used to clear the
  // mark unconditionally up front — cancelling the discard-confirm meant the
  // user never actually saw the target file, yet its dot vanished anyway.
  it("leaves the target file's unread mark when the user cancels the discard-changes confirm", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument()
    );
    await user.click(screen.getByTestId("sidebar-file-README.md"));
    await waitFor(() =>
      expect(screen.getByTestId("editor-active-path")).toHaveTextContent("README.md")
    );
    useOpenFiles.getState().updateActiveMarkdown("mock-root", "dirty edits");

    useChangedPaths.getState().mark("mock-root", "docs/intro.md");
    await user.click(screen.getByTestId("sidebar-dir-docs"));
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-docs/intro.md")).toBeInTheDocument()
    );

    await user.click(screen.getByTestId("sidebar-file-docs/intro.md"));
    await waitFor(() =>
      expect(screen.getByText("未保存の変更があります")).toBeInTheDocument()
    );
    await user.click(screen.getByRole("button", { name: "キャンセル" }));

    // The user never actually opened docs/intro.md — its mark must remain.
    expect(
      useChangedPaths.getState().isChanged("mock-root", "docs/intro.md")
    ).toBe(true);
    // The active tab did not change either.
    expect(screen.getByTestId("editor-active-path")).toHaveTextContent("README.md");
  });

  // #178 round 2 (codex review, must-fix): same rationale as above, but for
  // the "open a not-yet-open file" branch — a failed readFile must not clear
  // the mark, since the user still hasn't actually seen the file's content.
  it("leaves the target file's unread mark when readFile fails", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${API_BASE}/api/files/*`, ({ request }) => {
        const url = new URL(request.url);
        const path = url.pathname.replace(/^\/api\/files\//, "");
        if (path === "docs/intro.md") {
          return HttpResponse.json({ error: "boom" }, { status: 500 });
        }
        return HttpResponse.json({
          path,
          root: "mock-root",
          content: `# ${path}\n\nmock content`,
          modified: "2026-05-20T00:00:00Z",
          created: "2026-05-19T00:00:00Z",
          state: "draft",
        });
      })
    );

    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-dir-docs")).toBeInTheDocument()
    );
    useChangedPaths.getState().mark("mock-root", "docs/intro.md");

    await user.click(screen.getByTestId("sidebar-dir-docs"));
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-docs/intro.md")).toBeInTheDocument()
    );
    await user.click(screen.getByTestId("sidebar-file-docs/intro.md"));

    await waitFor(() => {
      expect(useToast.getState().toasts.some((t) => t.severity === "error")).toBe(
        true
      );
    });
    expect(
      useChangedPaths.getState().isChanged("mock-root", "docs/intro.md")
    ).toBe(true);
  });
});
