// Tests for #280: the editor autosaves, and version history is cut at the
// handoff to the AI (copying the `mr comments` command) rather than at every
// save. Before this, one save = one revision, which autosave would have blown
// past the 20-revision cap with — evicting the very baseline the diff needs.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { EditorPage } from "./EditorPage";
import { useOpenFiles } from "@/hooks/useOpenFiles";
import { useToast } from "@/hooks/useToast";
import { useConfirm } from "@/hooks/useConfirm";
import { useUIStore } from "@/hooks/useUIStore";
import { server } from "@/test/mocks/server";
import { API_BASE_URL } from "@/api";

vi.mock("@/components/tiptap/TiptapEditor", () => ({
  TiptapEditor: () => <div data-testid="tiptap-editor" />,
}));

const DEFAULT_ROOT = "mock-root";
const API_BASE = API_BASE_URL.replace(/\/$/, "");
/** Must stay in sync with AUTOSAVE_IDLE_MS in EditorPage. */
const IDLE_MS = 10_000;

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/${DEFAULT_ROOT}`]}>
        <Routes>
          <Route path="/:root/*" element={<EditorPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** Opens README.md and edits its buffer, returning the tab's id. */
async function openDirtyReadme(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByTestId(`sidebar-file-README.md`));
  await waitFor(() =>
    expect(screen.getByTestId("editor-active-path")).toHaveTextContent("README.md")
  );
  act(() => {
    useOpenFiles.getState().updateActiveMarkdown(DEFAULT_ROOT, "# edited\n");
  });
  const id = useOpenFiles.getState().activeIdByRoot[DEFAULT_ROOT];
  expect(useOpenFiles.getState().files.find((f) => f.id === id)?.isDirty).toBe(true);
  return id;
}

/** Runs down the autosave idle timer without waiting in real time. */
function elapseIdle() {
  act(() => {
    vi.advanceTimersByTime(IDLE_MS);
  });
}

beforeEach(() => {
  // Installed before render so the autosave timer the first edit schedules is
  // a fake one; installing it afterwards leaves a real 10s timer nothing can
  // advance. `shouldAdvanceTime` keeps userEvent's own waits working.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  localStorage.clear();
  useOpenFiles.setState({ files: [], activeIdByRoot: {} });
  useToast.setState({ toasts: [] });
  useConfirm.setState({ pending: null, queue: [] });
  useUIStore.setState({ isCommentPaneOpen: false });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("EditorPage autosave (#280)", () => {
  it("writes the buffer to disk once typing has been idle", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const puts: string[] = [];
    server.use(
      http.put(`${API_BASE}/api/files/*`, async ({ request }) => {
        const body = (await request.json()) as { content: string };
        puts.push(body.content);
        return HttpResponse.json({
          path: "README.md",
          root: DEFAULT_ROOT,
          state: "review",
          modified: "2026-05-20T00:00:00Z",
          created: "2026-05-01T00:00:00Z",
          sha: "sha-after-autosave",
        });
      })
    );
    renderPage();
    const id = await openDirtyReadme(user);

    elapseIdle();

    await waitFor(() => expect(puts).toEqual(["# edited\n"]));
    await waitFor(() => {
      const file = useOpenFiles.getState().files.find((f) => f.id === id);
      expect(file?.isDirty).toBe(false);
      expect(file?.savedMarkdown).toBe("# edited\n");
      expect(file?.serverSha).toBe("sha-after-autosave");
    });
  });

  it("keeps the buffer dirty and only warns when the file changed outside the editor", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    server.use(
      http.put(`${API_BASE}/api/files/*`, () =>
        HttpResponse.json(
          { error: "file changed on disk", sha: "other", modified: "2026-05-21T00:00:00Z" },
          { status: 412 }
        )
      )
    );
    renderPage();
    const id = await openDirtyReadme(user);

    elapseIdle();

    await waitFor(() =>
      expect(
        useToast.getState().toasts.some((t) => t.message.includes("自動保存を中止"))
      ).toBe(true)
    );
    // No modal in the middle of typing — that decision belongs to the explicit
    // save button.
    expect(useConfirm.getState().pending).toBeNull();
    expect(useOpenFiles.getState().files.find((f) => f.id === id)?.isDirty).toBe(true);
  });
});

describe("EditorPage revision boundary (#280)", () => {
  it("snapshots a version when the review command is copied", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const revisionPosts: string[] = [];
    server.use(
      http.post(`${API_BASE}/api/revisions/*`, ({ request }) => {
        const url = new URL(request.url);
        revisionPosts.push(url.pathname.replace(/^\/api\/revisions\//, ""));
        return HttpResponse.json({
          path: "README.md",
          root: DEFAULT_ROOT,
          created: true,
          revision: { id: "r-001", ts: "2026-05-20T00:00:00Z", author: "human" },
        });
      })
    );
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    renderPage();
    await openDirtyReadme(user);
    await user.click(screen.getByTestId("editor-copy-review-command"));

    // The snapshot has to be of what the AI will read, so the save lands
    // first and only then is the version cut.
    await waitFor(() => expect(revisionPosts).toEqual(["README.md"]));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining("mr comments "))
    );
  });

  it("does not snapshot a version on an ordinary autosave", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const revisionPosts: string[] = [];
    server.use(
      http.post(`${API_BASE}/api/revisions/*`, () => {
        revisionPosts.push("called");
        return HttpResponse.json({ path: "README.md", root: DEFAULT_ROOT, created: true });
      })
    );
    renderPage();
    await openDirtyReadme(user);

    elapseIdle();

    await waitFor(() => {
      const id = useOpenFiles.getState().activeIdByRoot[DEFAULT_ROOT];
      expect(useOpenFiles.getState().files.find((f) => f.id === id)?.isDirty).toBe(false);
    });
    expect(revisionPosts).toEqual([]);
  });
});
