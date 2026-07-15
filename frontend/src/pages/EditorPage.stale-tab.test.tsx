import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import { EditorPage } from "./EditorPage";
import { useOpenFiles } from "@/hooks/useOpenFiles";
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
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/"]}>
        <EditorPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/**
 * Stale-tab revalidation on re-activation (#119 case 6): the file watcher
 * only checks whichever tab is *currently* active, so an inactive tab that
 * changed on disk while some other tab was focused would otherwise sit
 * stale until its next poll (up to FILE_WATCHER_INTERVAL_MS later). Clicking
 * back to it should trigger an immediate recheck instead of waiting.
 */
describe("EditorPage stale-tab revalidation on re-activation (#119 case 6)", () => {
  beforeEach(() => {
    localStorage.clear();
    useOpenFiles.setState({ files: [], activeIdByRoot: {} });
    useToast.setState({ toasts: [] });
    useConfirm.setState({ pending: null, queue: [] });
  });

  it("revalidates and reloads a re-activated tab immediately when its sha changed while inactive", async () => {
    const user = userEvent.setup();

    server.use(
      http.get(`${API_BASE}/api/files/README.md`, () =>
        HttpResponse.json({
          path: "README.md",
          root: "mock-root",
          content: "# README.md\n\noriginal content",
          modified: "2026-05-20T00:00:00Z",
          created: "2026-05-19T00:00:00Z",
          state: "draft",
          sha: "sha-v1",
        })
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

    // Open a second tab so README.md becomes the inactive one.
    await user.click(screen.getByTestId("sidebar-dir-docs"));
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-docs/intro.md")).toBeInTheDocument()
    );
    await user.click(screen.getByTestId("sidebar-file-docs/intro.md"));
    await waitFor(() =>
      expect(screen.getByTestId("editor-active-path")).toHaveTextContent("docs/intro.md")
    );

    // README.md changed on disk while it was inactive.
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
          content: "# README.md\n\nexternally updated content",
          modified: "2026-05-21T00:00:00Z",
          created: "2026-05-19T00:00:00Z",
          state: "draft",
          sha: "sha-v2",
        })
      )
    );

    // Reactivate the stale tab via the sidebar entry (handleSelect's
    // existing-tab branch). This alone, well under the 5s poll interval,
    // must be enough to trigger the reconcile.
    await user.click(screen.getByTestId("sidebar-file-README.md"));
    await waitFor(() =>
      expect(screen.getByTestId("editor-active-path")).toHaveTextContent("README.md")
    );

    await waitFor(() => {
      const active = useOpenFiles
        .getState()
        .files.find((f) => f.path === "README.md")!;
      expect(active.markdown).toBe("# README.md\n\nexternally updated content");
      expect(active.serverSha).toBe("sha-v2");
    });
    expect(useToast.getState().toasts.some((t) => t.severity === "info")).toBe(true);
  });

  it("also revalidates immediately when the stale tab is reactivated via the tab bar (not just the sidebar)", async () => {
    // Tab-bar clicks switch tabs via MUI Tabs' own onChange, a separate code
    // path from handleSelect — this must bump fileEventTrigger too, or a tab
    // reactivated by clicking its tab (the most common way to switch between
    // already-open tabs) would sit stale until the next 5s poll.
    const user = userEvent.setup();

    server.use(
      http.get(`${API_BASE}/api/files/README.md`, () =>
        HttpResponse.json({
          path: "README.md",
          root: "mock-root",
          content: "# README.md\n\noriginal content",
          modified: "2026-05-20T00:00:00Z",
          created: "2026-05-19T00:00:00Z",
          state: "draft",
          sha: "sha-v1",
        })
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

    // Open a second tab so README.md becomes the inactive one.
    await user.click(screen.getByTestId("sidebar-dir-docs"));
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-docs/intro.md")).toBeInTheDocument()
    );
    await user.click(screen.getByTestId("sidebar-file-docs/intro.md"));
    await waitFor(() =>
      expect(screen.getByTestId("editor-active-path")).toHaveTextContent("docs/intro.md")
    );

    // README.md changed on disk while it was inactive.
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
          content: "# README.md\n\nexternally updated via tab click",
          modified: "2026-05-21T00:00:00Z",
          created: "2026-05-19T00:00:00Z",
          state: "draft",
          sha: "sha-v2",
        })
      )
    );

    // Reactivate the stale tab by clicking it directly in the tab bar
    // (bypasses handleSelect — exercises the Tabs onChange path instead).
    await user.click(screen.getByTestId("editor-tab-README.md"));
    await waitFor(() =>
      expect(screen.getByTestId("editor-active-path")).toHaveTextContent("README.md")
    );

    await waitFor(() => {
      const active = useOpenFiles
        .getState()
        .files.find((f) => f.path === "README.md")!;
      expect(active.markdown).toBe("# README.md\n\nexternally updated via tab click");
      expect(active.serverSha).toBe("sha-v2");
    });
    expect(useToast.getState().toasts.some((t) => t.severity === "info")).toBe(true);
  });
});
