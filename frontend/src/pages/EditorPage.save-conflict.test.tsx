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
 * Save-conflict handling (#119 case 5): a PUT rejected with 412 means the
 * server refused to write because the on-disk sha no longer matches the
 * `If-Match` we sent — someone else changed the file since we last
 * read/wrote it. These tests exercise the If-Match header on a normal save
 * and the resulting conflict dialog's two outcomes.
 */
describe("EditorPage save conflict (#119 case 5)", () => {
  beforeEach(() => {
    localStorage.clear();
    useOpenFiles.setState({ files: [], activeIdByRoot: {} });
    useToast.setState({ toasts: [] });
    useConfirm.setState({ pending: null, queue: [] });
  });

  async function openAndDirtyReadme(user: ReturnType<typeof userEvent.setup>) {
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument()
    );
    await user.click(screen.getByTestId("sidebar-file-README.md"));
    await waitFor(() =>
      expect(screen.getByTestId("editor-active-path")).toHaveTextContent("README.md")
    );
    useOpenFiles.getState().updateActiveMarkdown("mock-root", "edited content");
  }

  it("sends If-Match with the file's serverSha on a normal save", async () => {
    const user = userEvent.setup();
    const capturedHeaders: (string | null)[] = [];

    server.use(
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
        capturedHeaders.push(request.headers.get("If-Match"));
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

    await openAndDirtyReadme(user);
    await user.click(screen.getByTestId("editor-save"));

    await waitFor(() => expect(capturedHeaders).toHaveLength(1));
    expect(capturedHeaders[0]).toBe("sha-current");
    await waitFor(() => {
      const active = useOpenFiles
        .getState()
        .files.find((f) => f.id === useOpenFiles.getState().activeIdByRoot["mock-root"])!;
      expect(active.serverSha).toBe("sha-new");
      expect(active.isDirty).toBe(false);
    });
  });

  it("shows a conflict dialog on 412, and retries without If-Match on 上書き保存", async () => {
    const user = userEvent.setup();
    const capturedHeaders: (string | null)[] = [];
    let putCount = 0;

    server.use(
      http.get(`${API_BASE}/api/files/*`, () =>
        HttpResponse.json({
          path: "README.md",
          root: "mock-root",
          content: "# README.md\n\nmock content",
          modified: "2026-05-20T00:00:00Z",
          created: "2026-05-19T00:00:00Z",
          state: "draft",
          sha: "sha-stale",
        })
      ),
      http.put(`${API_BASE}/api/files/*`, async ({ request }) => {
        putCount += 1;
        capturedHeaders.push(request.headers.get("If-Match"));
        const body = (await request.json()) as { content: string };
        if (putCount === 1) {
          return HttpResponse.json(
            {
              error: "file changed on disk",
              sha: "sha-fresh",
              modified: "2026-05-22T00:00:00Z",
            },
            { status: 412 }
          );
        }
        return HttpResponse.json({
          path: "README.md",
          root: "mock-root",
          content: body.content,
          modified: "2026-05-23T00:00:00Z",
          created: "2026-05-19T00:00:00Z",
          state: "draft",
          sha: "sha-overwritten",
        });
      })
    );

    await openAndDirtyReadme(user);
    await user.click(screen.getByTestId("editor-save"));

    await waitFor(() =>
      expect(screen.getByText("保存の競合")).toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: "上書き保存" }));

    await waitFor(() => expect(capturedHeaders).toHaveLength(2));
    expect(capturedHeaders[0]).toBe("sha-stale");
    // Retry omits If-Match entirely (legacy last-write-wins overwrite).
    expect(capturedHeaders[1]).toBeNull();

    await waitFor(() => {
      const active = useOpenFiles
        .getState()
        .files.find((f) => f.id === useOpenFiles.getState().activeIdByRoot["mock-root"])!;
      expect(active.isDirty).toBe(false);
      expect(active.serverSha).toBe("sha-overwritten");
    });
    expect(
      useToast.getState().toasts.some((t) => t.severity === "success")
    ).toBe(true);
  });

  it("leaves the file dirty and writes nothing further when the user cancels the conflict dialog", async () => {
    const user = userEvent.setup();
    let putCount = 0;

    server.use(
      http.get(`${API_BASE}/api/files/*`, () =>
        HttpResponse.json({
          path: "README.md",
          root: "mock-root",
          content: "# README.md\n\nmock content",
          modified: "2026-05-20T00:00:00Z",
          created: "2026-05-19T00:00:00Z",
          state: "draft",
          sha: "sha-stale",
        })
      ),
      http.put(`${API_BASE}/api/files/*`, () => {
        putCount += 1;
        return HttpResponse.json(
          {
            error: "file changed on disk",
            sha: "sha-fresh",
            modified: "2026-05-22T00:00:00Z",
          },
          { status: 412 }
        );
      })
    );

    await openAndDirtyReadme(user);
    await user.click(screen.getByTestId("editor-save"));

    await waitFor(() =>
      expect(screen.getByText("保存の競合")).toBeInTheDocument()
    );
    await user.click(screen.getByRole("button", { name: "キャンセル" }));

    await waitFor(() => expect(useConfirm.getState().pending).toBeNull());
    expect(putCount).toBe(1);
    const active = useOpenFiles
      .getState()
      .files.find((f) => f.id === useOpenFiles.getState().activeIdByRoot["mock-root"])!;
    expect(active.isDirty).toBe(true);
    expect(active.markdown).toBe("edited content");
  });
});
