import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { EditorPage } from "./EditorPage";
import { useOpenFiles } from "@/hooks/useOpenFiles";
import { useToast } from "@/hooks/useToast";
import { useConfirm } from "@/hooks/useConfirm";
import { useRecentOpened } from "@/hooks/useRecentOpened";

const API_BASE = "http://localhost:8080";
const OTHER_ROOT = "root-b";

// Matches the /api/config mock handler's review_roots[0].name (see
// EditorPage.test.tsx, which this file mirrors the conventions of).
const DEFAULT_ROOT = "mock-root";

vi.mock("@/components/tiptap/TiptapEditor", () => ({
  TiptapEditor: () => <div data-testid="tiptap-editor" />,
}));

function LocationProbe() {
  const loc = useLocation();
  return (
    <>
      <span data-testid="loc-pathname">{loc.pathname}</span>
      <span data-testid="loc-search">{loc.search}</span>
    </>
  );
}

function renderPage(initialPath: string) {
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

// #289: `?open=<rel>` (repeatable) opens extra files as background tabs
// alongside the path-addressed main file on first mount.
describe("EditorPage multi-file deeplink (#289)", () => {
  beforeEach(() => {
    localStorage.clear();
    useOpenFiles.setState({ files: [], activeIdByRoot: {} });
    useToast.setState({ toasts: [] });
    useConfirm.setState({ pending: null, queue: [] });
    useRecentOpened.setState({ entries: [] });
  });

  it("opens the main path and every open= path, main stays active, tabs in main→open order", async () => {
    renderPage(
      `/${DEFAULT_ROOT}/README.md?open=docs/intro.md&open=docs/api/spec.md`
    );

    await waitFor(() => {
      expect(screen.getByTestId("editor-active-path")).toHaveTextContent("README.md");
    });
    await waitFor(() => {
      expect(
        useOpenFiles.getState().files.map((f) => f.path)
      ).toEqual(["README.md", "docs/intro.md", "docs/api/spec.md"]);
    });

    const state = useOpenFiles.getState();
    const activeId = state.activeIdByRoot[DEFAULT_ROOT];
    const active = state.files.find((f) => f.id === activeId);
    expect(active?.path).toBe("README.md");
  });

  it("keeps opening the remaining open= paths when one of them fails to read, and toasts the failure", async () => {
    const { http, HttpResponse } = await import("msw");
    const { server } = await import("@/test/mocks/server");
    server.use(
      http.get("http://localhost:8080/api/files/*", ({ request }) => {
        const url = new URL(request.url);
        const path = url.pathname.replace(/^\/api\/files\//, "");
        if (path === "docs/unreadable.md") {
          return HttpResponse.json({ error: "not found" }, { status: 404 });
        }
        return HttpResponse.json({
          path,
          root: url.searchParams.get("root") ?? "mock-root",
          content: `# ${path}\n\nmock content`,
        });
      })
    );

    renderPage(
      `/${DEFAULT_ROOT}/README.md?open=docs/unreadable.md&open=docs/intro.md`
    );

    await waitFor(() => {
      const toasts = useToast.getState().toasts;
      expect(toasts.some((t) => t.severity === "error")).toBe(true);
    });
    await waitFor(() => {
      expect(
        useOpenFiles.getState().files.map((f) => f.path)
      ).toEqual(["README.md", "docs/intro.md"]);
    });
    expect(screen.getByTestId("editor-active-path")).toHaveTextContent("README.md");
  });

  it("leaves ?open= in the URL after the deeplink expands into tabs", async () => {
    renderPage(`/${DEFAULT_ROOT}/README.md?open=docs/intro.md`);

    await waitFor(() => {
      expect(
        useOpenFiles.getState().files.map((f) => f.path)
      ).toEqual(["README.md", "docs/intro.md"]);
    });
    expect(screen.getByTestId("loc-search")).toHaveTextContent("open=docs/intro.md");
  });

  it("does not open the same path twice when it is also named in ?open=", async () => {
    renderPage(`/${DEFAULT_ROOT}/README.md?open=README.md&open=docs/intro.md`);

    await waitFor(() => {
      expect(
        useOpenFiles.getState().files.map((f) => f.path)
      ).toEqual(["README.md", "docs/intro.md"]);
    });
  });

  // #289 follow-up 2 regression: `open=` is root-relative, so it must not
  // survive a root switch. Reproduces the exact reported symptom: switch
  // root, open a different file in the new root (the tab-sync effect
  // carries the query string along with the path), then simulate reloading
  // that resulting URL and confirm the stale `open=` from the old root
  // doesn't silently attach an extra tab under the new root.
  it("drops open= on a root switch, so a later reload of that root's URL never opens the old root's extra under it", async () => {
    const user = userEvent.setup();
    const { http, HttpResponse } = await import("msw");
    const { server } = await import("@/test/mocks/server");
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
      )
    );

    renderPage(`/${DEFAULT_ROOT}/README.md?open=docs/intro.md`);
    await waitFor(() => {
      expect(
        useOpenFiles.getState().files.map((f) => f.path)
      ).toEqual(["README.md", "docs/intro.md"]);
    });

    // Switch root via the sidebar's root switcher (the real UI path, same
    // as RootSelect.tsx -> useActiveRoot().setActive).
    await user.click(screen.getByTestId("sidebar-review-root"));
    await waitFor(() =>
      expect(screen.getByTestId("root-select-menu")).toBeInTheDocument()
    );
    await user.click(screen.getByTestId(`root-select-item-${OTHER_ROOT}`));
    await waitFor(() =>
      expect(screen.getByTestId("loc-pathname")).toHaveTextContent(`/${OTHER_ROOT}`)
    );
    // The fix: open= must already be gone right after the switch, before
    // any file in the new root is even opened.
    expect(screen.getByTestId("loc-search").textContent).toBe("");

    // Open a different file in the new root — the tab-sync effect rewrites
    // the URL to /{root}/{path} carrying `location.search` along (#236),
    // which is exactly how a stale open= would otherwise leak into the new
    // root's own file URL.
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument()
    );
    await user.click(screen.getByTestId("sidebar-file-README.md"));
    await waitFor(() =>
      expect(screen.getByTestId("editor-active-path")).toHaveTextContent("README.md")
    );
    const searchAfterOpen = screen.getByTestId("loc-search").textContent ?? "";
    expect(searchAfterOpen).not.toContain("open=");

    // Simulate a fresh page load of exactly that resulting URL (a reload,
    // or the user sharing/bookmarking it) — a clean store, same as a real
    // reload would start with.
    cleanup();
    useOpenFiles.setState({ files: [], activeIdByRoot: {} });
    renderPage(`/${OTHER_ROOT}/README.md${searchAfterOpen}`);
    await waitFor(() => {
      expect(screen.getByTestId("editor-active-path")).toHaveTextContent("README.md");
    });

    const rootBFiles = useOpenFiles
      .getState()
      .files.filter((f) => f.root === OTHER_ROOT)
      .map((f) => f.path);
    expect(rootBFiles).toEqual(["README.md"]);
    expect(rootBFiles).not.toContain("docs/intro.md");
  });

  // #289 follow-up 3: switching root while a deeplink's extra is still
  // in flight must not attach that extra to any root's tab list once the
  // read finally resolves — neither the root the page left (correctness:
  // the user is no longer looking at it) nor the root the page switched to
  // (docs/intro.md was never asked for under root-b).
  it("drops an in-flight open= extra instead of attaching it to a root the page has already left", async () => {
    const user = userEvent.setup();
    const { http, HttpResponse } = await import("msw");
    const { server } = await import("@/test/mocks/server");
    let releaseExtra: () => void = () => {};
    const extraGate = new Promise<void>((resolve) => {
      releaseExtra = resolve;
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
      http.get(`${API_BASE}/api/files/*`, async ({ request }) => {
        const url = new URL(request.url);
        const path = url.pathname.replace(/^\/api\/files\//, "");
        if (path === "docs/intro.md") {
          // Held open until the test releases it, well after the root
          // switch below — simulates a slow read that outlives the page
          // showing the root it was requested for.
          await extraGate;
        }
        return HttpResponse.json({
          path,
          root: url.searchParams.get("root") ?? DEFAULT_ROOT,
          content: `# ${path}\n\nmock content`,
        });
      })
    );

    renderPage(`/${DEFAULT_ROOT}/README.md?open=docs/intro.md`);
    await waitFor(() => {
      expect(screen.getByTestId("editor-active-path")).toHaveTextContent("README.md");
    });
    // Main is open; docs/intro.md's read is still gated (in flight).
    expect(useOpenFiles.getState().files.map((f) => f.path)).toEqual(["README.md"]);

    await user.click(screen.getByTestId("sidebar-review-root"));
    await waitFor(() =>
      expect(screen.getByTestId("root-select-menu")).toBeInTheDocument()
    );
    await user.click(screen.getByTestId(`root-select-item-${OTHER_ROOT}`));
    await waitFor(() =>
      expect(screen.getByTestId("loc-pathname")).toHaveTextContent(`/${OTHER_ROOT}`)
    );

    releaseExtra();
    // Give the now-resolved (but guarded) read a moment to reach the store.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const allPaths = useOpenFiles.getState().files.map((f) => `${f.root}:${f.path}`);
    expect(allPaths).not.toContain(`${DEFAULT_ROOT}:docs/intro.md`);
    expect(allPaths).not.toContain(`${OTHER_ROOT}:docs/intro.md`);
    // The failure branch must also stay quiet — a toast about a root the
    // page isn't showing anymore would be as misleading as opening the tab.
    expect(useToast.getState().toasts.some((t) => t.severity === "error")).toBe(false);
  });
});
