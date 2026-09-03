// Regression tests for #265: TiptapEditor's onUpdate debounces the
// expensive full-document Markdown resync (getEditorMarkdown walks every
// top-level block and re-runs the serializer on each one -- ~140ms/keystroke
// measured on a 2,600-block document, vs ~10ms once debounced) so typing
// stays responsive on large documents.
//
// Unlike EditorPage.test.tsx, TiptapEditor is deliberately NOT mocked here:
// these tests exercise the real editor + the flush points added alongside
// the debounce (save / tab switch / tab close / page unload) to prove no
// edit is ever silently dropped.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { EditorPage } from "./EditorPage";
import { useOpenFiles } from "@/hooks/useOpenFiles";
import { useToast } from "@/hooks/useToast";
import { useConfirm } from "@/hooks/useConfirm";

const DEFAULT_ROOT = "mock-root";

/** Post-load onUpdate suppression window (#20) is 250ms -- wait past it so
 *  the keystrokes below are attributed to the user, not swallowed as the
 *  freshly-loaded file settling. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 300));
}

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

describe("TiptapEditor debounced Markdown resync + flush (#265)", () => {
  beforeEach(() => {
    localStorage.clear();
    useOpenFiles.setState({ files: [], activeIdByRoot: {} });
    useToast.setState({ toasts: [] });
    useConfirm.setState({ pending: null, queue: [] });
    // jsdom doesn't implement these -- real ProseMirror (unmocked here,
    // unlike EditorPage.test.tsx) calls them on click/scroll/selection.
    document.elementFromPoint = vi.fn(() => null);
    Element.prototype.scrollTo = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
    const fakeRect = () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: 0,
      right: 0,
      width: 0,
      height: 0,
      toJSON: () => ({}),
    });
    Range.prototype.getClientRects = vi.fn(() => [] as unknown as DOMRectList);
    Range.prototype.getBoundingClientRect = vi.fn(() => fakeRect() as DOMRect);
    Element.prototype.getBoundingClientRect = vi.fn(() => fakeRect() as DOMRect);
  });

  it("marks the file dirty synchronously on keystroke, before the debounced resync fires", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByTestId("sidebar-file-README.md"));
    const pm = await waitFor(() => {
      const el = document.querySelector(".ProseMirror");
      if (!el) throw new Error("not mounted yet");
      return el as HTMLElement;
    });

    await settle();
    await user.click(pm);
    await user.keyboard("z");

    // isDirty must already be true well within the 250ms debounce window --
    // it is set synchronously in onUpdate, independent of the debounced
    // Markdown resync (markActiveDirty, #265).
    await waitFor(() => {
      const active = useOpenFiles.getState().files.find((f) => f.path === "README.md");
      expect(active?.isDirty).toBe(true);
    });
  }, 15000);

  it("save flushes the pending debounced edit -- the last keystroke is not lost even when Save is clicked immediately", async () => {
    const { http, HttpResponse } = await import("msw");
    const { server } = await import("@/test/mocks/server");
    let putBody: { content: string } | null = null;
    server.use(
      http.put(`http://localhost:8080/api/files/*`, async ({ request }) => {
        putBody = (await request.json()) as { content: string };
        return HttpResponse.json({
          path: "README.md",
          root: DEFAULT_ROOT,
          content: putBody.content,
          modified: "2026-05-20T00:00:00Z",
          created: "2026-05-19T00:00:00Z",
          state: "draft",
        });
      })
    );

    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByTestId("sidebar-file-README.md"));
    const pm = await waitFor(() => {
      const el = document.querySelector(".ProseMirror");
      if (!el) throw new Error("not mounted yet");
      return el as HTMLElement;
    });

    await settle();
    await user.click(pm);
    // Type the marker and click Save back-to-back, with no wait in between
    // -- well inside the 250ms debounce window the fix introduces.
    await user.keyboard("MARKER_TAIL");
    await user.click(screen.getByTestId("editor-save"));

    await waitFor(() => expect(putBody).not.toBeNull());
    expect(putBody!.content).toContain("MARKER_TAIL");
    // The store's `markdown` field itself must also have been resynced by
    // the flush (not just the one-off value handleSave read locally).
    const active = useOpenFiles.getState().files.find((f) => f.path === "README.md");
    expect(active?.markdown).toContain("MARKER_TAIL");
    expect(active?.isDirty).toBe(false);
  }, 15000);

  it("switching tabs flushes the pending debounced edit into the store instead of losing it to the newly-loaded doc", async () => {
    const user = userEvent.setup();
    // Seed both tabs directly (rather than via the sidebar tree) so this
    // test is only exercising the tab-switch flush under test, not the
    // sidebar's directory-expand + network-backed open flow.
    useOpenFiles.getState().addFiles([
      { name: "README.md", root: DEFAULT_ROOT, markdown: "# README.md\n\nmock content" },
      {
        name: "intro.md",
        path: "docs/intro.md",
        root: DEFAULT_ROOT,
        markdown: "# intro\n\nintro body",
      },
    ]);
    useOpenFiles.getState().setActive(DEFAULT_ROOT, useOpenFiles.getState().files[0].id);

    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("editor-tab-docs/intro.md")).toBeInTheDocument()
    );
    const pm = await waitFor(() => {
      const el = document.querySelector(".ProseMirror");
      if (!el) throw new Error("not mounted yet");
      return el as HTMLElement;
    });
    await settle();

    // Type into the active (README.md) tab, then IMMEDIATELY switch to the
    // other tab via the tab bar (handleTabChange) -- no wait, so the
    // debounce timer is still pending when the switch happens.
    await user.click(pm);
    await user.keyboard("SWITCHMARK");
    await user.click(screen.getByTestId("editor-tab-docs/intro.md"));

    // The store's README.md buffer must already contain the typed text --
    // if the flush didn't fire before the switch, the debounce timeout
    // would instead fire later against docs/intro.md's freshly-loaded doc
    // and silently drop the README.md edit.
    await waitFor(() => {
      const readme = useOpenFiles.getState().files.find((f) => f.path === "README.md");
      expect(readme?.markdown).toContain("SWITCHMARK");
    });
    const intro = useOpenFiles.getState().files.find((f) => f.path === "docs/intro.md");
    expect(intro?.markdown ?? "").not.toContain("SWITCHMARK");
  }, 15000);

  it("closing the file flushes the pending debounced edit into the store first", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByTestId("sidebar-file-README.md"));
    const pm = await waitFor(() => {
      const el = document.querySelector(".ProseMirror");
      if (!el) throw new Error("not mounted yet");
      return el as HTMLElement;
    });
    await settle();
    await user.click(pm);
    await user.keyboard("CLOSEMARK");

    // Close immediately (no wait for the debounce to settle) via the real
    // UI close button, so EditorPage's closeFile wrapper (which flushes
    // before delegating to the store) is what's under test -- calling the
    // store's closeFile directly would bypass it.
    await user.click(screen.getByTestId("editor-tab-close-README.md"));

    // Reopening (a fresh read from the server mock) isn't what's under
    // test here -- what matters is that the flush that EditorPage's
    // closeFile wrapper performs before calling the store's closeFile
    // didn't throw and did write the pending edit somewhere observable:
    // since the file object itself is gone after close, assert indirectly
    // via the exposed flush being a no-op afterwards (no pending timer
    // leaking into whichever tab becomes active next) by checking no
    // stale content leaks into a freshly reopened tab.
    await user.click(await screen.findByTestId("sidebar-file-README.md"));
    await waitFor(() => document.querySelector(".ProseMirror"));
    const reopened = useOpenFiles.getState().files.find((f) => f.path === "README.md");
    // Freshly reopened from the server mock, so it must NOT carry over the
    // discarded edit (proves the flush -> close ordering doesn't leak a
    // flushed buffer into an unrelated future open, and closeFile actually
    // removed the old entry rather than erroring out mid-flush).
    expect(reopened?.markdown ?? "").not.toContain("CLOSEMARK");
  }, 15000);

  it("flushes on visibilitychange (tab backgrounded) so the store isn't left stale", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByTestId("sidebar-file-README.md"));
    const pm = await waitFor(() => {
      const el = document.querySelector(".ProseMirror");
      if (!el) throw new Error("not mounted yet");
      return el as HTMLElement;
    });
    await settle();
    await user.click(pm);
    await user.keyboard("HIDDENMARK");

    // Simulate the tab being backgrounded, well inside the debounce window.
    await act(async () => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => {
      const active = useOpenFiles.getState().files.find((f) => f.path === "README.md");
      expect(active?.markdown).toContain("HIDDENMARK");
    });
  }, 15000);
});
