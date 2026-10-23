// Regression test for #289 follow-up: opening a `?open=` deeplink used to
// leave the last background tab spuriously dirty (unsaved dot, autosave
// rewrites the file on disk with tiptap-markdown's roundtrip normalization)
// even though nothing was ever edited.
//
// Root cause: the original implementation opened each `open=` path by
// briefly activating it via handleSelect (same path as a real tab click),
// then reactivating the main path once all of them were open. Activating a
// file routes its content through the single shared TiptapEditor instance,
// which opens a post-load "settle window" (#20) to suppress the onUpdate
// that ProseMirror's own post-setContent extension transactions (autolink,
// BlankLines, ...) fire, and schedules a debounced Markdown resync (#265)
// that recomputes `isDirty` by comparing the re-serialized document against
// `savedMarkdown`. Chaining activate → deactivate → activate-the-next-one in
// quick succession raced that debounce: by the time the last background
// tab's resync fired, a later file was already active, and the resync wrote
// a re-serialized Markdown string into whichever file was active at that
// moment — flipping it dirty despite the user never touching it.
//
// The fix opens background tabs via a path that never activates them
// (openServerFile(..., { activate: false })), so their content never enters
// the shared editor and the debounce/settle-window race can't happen. This
// test exercises the real TiptapEditor (not mocked, unlike
// EditorPage.multi-open.test.tsx) so the actual onUpdate/debounce machinery
// runs, the same way EditorPage.debounce-flush.test.tsx does for #265.
//
// The default /api/files/* mock echoes the path into the heading (e.g.
// "# README.md"), which MarkdownLink's autolink turns into a real link on
// load regardless of this bug — that's a pre-existing, unrelated content
// quirk of the shared test fixture, not something #289 touches. This file
// overrides /api/files/* with plain prose bodies so the only thing that can
// flip isDirty is the bug under test.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { EditorPage } from "./EditorPage";
import { useOpenFiles } from "@/hooks/useOpenFiles";
import { useToast } from "@/hooks/useToast";
import { useConfirm } from "@/hooks/useConfirm";

const DEFAULT_ROOT = "mock-root";
const API_BASE = "http://localhost:8080";

const BODIES: Record<string, string> = {
  "README.md": "# Main document\n\nJust some prose, nothing link-like.\n",
  "docs/intro.md": "# Intro document\n\nMore plain prose here.\n",
  "docs/api/spec.md": "# Spec document\n\nEven more plain prose.\n",
};

function renderPage(initialPath: string) {
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

// Well past the 250ms post-load settle window (#20) and the 250ms debounced
// Markdown resync (#265) — long enough that, before the fix, the buggy
// resync had definitely already fired and flipped the last tab dirty.
async function settleWellPastDebounce() {
  await new Promise((resolve) => setTimeout(resolve, 800));
}

// Every /api/files/* request the current test's mock handler has served,
// oldest first. Reset in beforeEach, read by waitForRequestsToSettle below.
let requestedPaths: string[] = [];

// The deeplink-expansion effect (EditorPage's `initialFilePathRef` effect)
// opens the main path and every `open=` extra as one sequential, un-awaited
// `void (async () => { ... })()` chain — it isn't tied to the component's
// render lifecycle, so unmounting the page (afterEach's cleanup()) does not
// cancel it if it's still mid-flight. If that chain is still issuing
// requests when the *next* test's beforeEach resets the shared
// `useOpenFiles` store, the stray `openServerFile` call it eventually makes
// lands in the next test's state instead of this one's — exactly the
// "tab order flipped" cross-test leak this file used to hit in CI (a slow
// first test's third `open=` request settled only after the next test had
// already started). Draining here, before the shared store is ever reset,
// makes the two tests independent regardless of how slow either one runs.
//
// This is independent of (and a backstop for) generous `waitFor` timeouts
// on the assertions below: those already imply "the chain reached this
// point", but only if they resolve before their own timeout. Idle-polling
// the actual request log ties draining to real completion instead of a
// fixed duration.
// maxWaitMs stays under vitest's default 10s hookTimeout (afterEach runs
// this) with margin to spare.
async function waitForRequestsToSettle(idleMs = 300, maxWaitMs = 8_000) {
  const start = Date.now();
  let lastCount = requestedPaths.length;
  let lastChangeAt = Date.now();
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (requestedPaths.length !== lastCount) {
      lastCount = requestedPaths.length;
      lastChangeAt = Date.now();
    } else if (Date.now() - lastChangeAt >= idleMs) {
      return;
    }
    if (Date.now() - start >= maxWaitMs) return;
  }
}

describe("EditorPage multi-open deeplink dirty tracking (#289 follow-up)", () => {
  beforeEach(async () => {
    requestedPaths = [];
    localStorage.clear();
    useOpenFiles.setState({ files: [], activeIdByRoot: {} });
    useToast.setState({ toasts: [] });
    useConfirm.setState({ pending: null, queue: [] });
    // jsdom doesn't implement these — real ProseMirror (unmocked here)
    // calls them on load/click/scroll/selection.
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

    const { http, HttpResponse, delay } = await import("msw");
    const { server } = await import("@/test/mocks/server");
    server.use(
      http.get(`${API_BASE}/api/files/*`, async ({ request }) => {
        const url = new URL(request.url);
        const path = url.pathname.replace(/^\/api\/files\//, "");
        requestedPaths.push(path);
        // A little real async latency per read (unlike MSW's otherwise
        // near-instant resolution) is what actually exposes the original
        // activate/deactivate race: it gives the browser's event loop real
        // gaps between opens, the same as an actual network round-trip
        // against a live server.
        await delay(20);
        return HttpResponse.json({
          path,
          root: url.searchParams.get("root") ?? "mock-root",
          content: BODIES[path] ?? "# Untitled\n\nplain prose\n",
          modified: "2026-05-20T00:00:00Z",
          created: "2026-05-19T00:00:00Z",
          state: "draft",
        });
      })
    );
  });

  afterEach(async () => {
    // Unmount first so no further DOM-driven ProseMirror activity starts,
    // then drain the deeplink-expansion chain (see waitForRequestsToSettle)
    // before the next test's beforeEach resets the shared useOpenFiles
    // store out from under it.
    cleanup();
    await waitForRequestsToSettle();
    useOpenFiles.setState({ files: [], activeIdByRoot: {} });
  });

  it(
    "leaves every tab clean after a multi-file deeplink settles, none autosave-eligible",
    async () => {
      renderPage(
        `/${DEFAULT_ROOT}/README.md?open=docs/intro.md&open=docs/api/spec.md`
      );

      // 10s, well above the 5s default: this test drives a real (unmocked)
      // ProseMirror instance through three sequential file opens, each with
      // its own network round-trip — CI's slower, shared runners have been
      // observed to blow well past the default waitFor timeout (1s) here
      // even though nothing is actually wrong, which used to fail this
      // assertion outright and then leak the still-in-flight third open
      // into the next test (see waitForRequestsToSettle's comment).
      await waitFor(
        () => {
          expect(
            useOpenFiles.getState().files.map((f) => f.path)
          ).toEqual(["README.md", "docs/intro.md", "docs/api/spec.md"]);
        },
        { timeout: 10_000 }
      );
      await waitFor(
        () => {
          expect(screen.getByTestId("editor-active-path")).toHaveTextContent(
            "README.md"
          );
        },
        { timeout: 10_000 }
      );

      await settleWellPastDebounce();

      const dirty = useOpenFiles
        .getState()
        .files.filter((f) => f.isDirty)
        .map((f) => f.path);
      expect(dirty).toEqual([]);
    },
    // Test-level timeout: must exceed the waitFor timeouts above (10s each,
    // sequential) plus the 800ms settle wait, or vitest's own 5s default
    // would cut the test short before waitFor gets the chance to.
    25_000
  );

  it(
    "keeps the last background tab clean even with only one open= alongside the main path",
    async () => {
      // Same intent as the test above, but with the minimal shape (one main
      // + one extra) that most directly exercised the old
      // activate-then-deactivate race, since the single background tab used
      // to be activated right before the effect reactivated the main path.
      renderPage(`/${DEFAULT_ROOT}/README.md?open=docs/api/spec.md`);

      // See the timeout comment on the test above — same CI-slowness reason,
      // scaled down slightly since this test only opens two files.
      await waitFor(
        () => {
          expect(
            useOpenFiles.getState().files.map((f) => f.path)
          ).toEqual(["README.md", "docs/api/spec.md"]);
        },
        { timeout: 10_000 }
      );

      await settleWellPastDebounce();

      const specTab = useOpenFiles
        .getState()
        .files.find((f) => f.path === "docs/api/spec.md");
      expect(specTab?.isDirty).toBe(false);
      const mainTab = useOpenFiles
        .getState()
        .files.find((f) => f.path === "README.md");
      expect(mainTab?.isDirty).toBe(false);
    },
    15_000
  );
});
