// Regression test for #265 follow-up: `meaningfulRevisions` in EditorPage
// used to be an unmemoized `revisions.filter(... lineDiff(...))` computed on
// every render. lineDiff is an O(n*m) LCS over every line of the document,
// run once per revision -- on a real multi-thousand-line document with a
// handful of revisions, that is 1000ms+ *per render*, and EditorPage
// re-renders on unrelated state changes (e.g. toggling the comment pane)
// while the user is typing. This dwarfed the TiptapEditor onUpdate debounce
// added earlier in #265, which only throttles the *editor's* own update and
// never touches this page-level cost.
//
// This test asserts lineDiff's call count for the active file's revisions
// stays bounded across unrelated re-renders, rather than growing with each
// one -- the actual mechanism that made the bug invisible on small fixtures
// (cheap enough not to notice) and severe on real documents.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import * as lineDiffModule from "@/utils/lineDiff";
import { EditorPage } from "./EditorPage";
import { useOpenFiles } from "@/hooks/useOpenFiles";
import { useToast } from "@/hooks/useToast";
import { useConfirm } from "@/hooks/useConfirm";
import { useUIStore } from "@/hooks/useUIStore";

vi.mock("@/components/tiptap/TiptapEditor", () => ({
  TiptapEditor: () => <div data-testid="tiptap-editor" />,
}));

const DEFAULT_ROOT = "mock-root";

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

describe("EditorPage meaningfulRevisions memoization (#265 follow-up)", () => {
  beforeEach(() => {
    localStorage.clear();
    useOpenFiles.setState({ files: [], activeIdByRoot: {} });
    useToast.setState({ toasts: [] });
    useConfirm.setState({ pending: null, queue: [] });
    useUIStore.setState({ isCommentPaneOpen: false });
  });

  it("does not re-run lineDiff on unrelated re-renders once revisions/content settle", async () => {
    const lineDiffSpy = vi.spyOn(lineDiffModule, "lineDiff");
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
        if (id) {
          return HttpResponse.json({
            id,
            ts: "2026-05-20T00:00:00Z",
            author: "ai",
            content: `# README.md\n\nprevious content ${id}`,
          });
        }
        return HttpResponse.json({
          path: "README.md",
          root: "mock-root",
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

    // Let revisions + their content settle (versionReady, revContents fetch).
    await waitFor(() =>
      expect(screen.getByTestId("editor-active-version")).toHaveTextContent("v3")
    );

    const callsAfterSettle = lineDiffSpy.mock.calls.length;
    expect(callsAfterSettle).toBeGreaterThan(0);

    // Force several EditorPage re-renders via state that has nothing to do
    // with revisions/revContents/the active file's savedMarkdown -- toggling
    // the comment pane subscribes EditorPage to a store update and
    // re-renders it, exactly like the isDirty flips that fire while typing.
    // Driven directly via the store (rather than clicking the toggle
    // button) since the button that opens the pane disappears once it's
    // open, replaced by a different close control.
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        useUIStore.getState().toggleCommentPane();
      });
    }

    // Unmemoized, each of the 5 renders above would have re-run lineDiff for
    // both revisions (10 more calls). Memoized, the call count must not grow
    // at all: none of revisions/revContents/diffLatestText changed.
    expect(lineDiffSpy.mock.calls.length).toBe(callsAfterSettle);
  });
});
