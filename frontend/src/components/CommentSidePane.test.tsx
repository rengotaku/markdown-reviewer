import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommentSidePane } from "./CommentSidePane";
import type { CommentJSON } from "@/api";

const comment = (id: string, overrides: Partial<CommentJSON> = {}): CommentJSON => ({
  id,
  scope: "inline",
  author: "alice",
  date: "2026-05-20",
  body: `body of ${id}`,
  status: "open",
  anchor: { heading_path: ["## Sec"], snippet: "text", occurrence: 0 },
  context: { heading_path: ["## Sec"], line_range: [3, 3] },
  orphan: false,
  ...overrides,
});

function renderPane(props: Partial<React.ComponentProps<typeof CommentSidePane>> = {}) {
  const handlers = {
    onClose: vi.fn(),
    onAddComment: vi.fn(),
    onAddGlobal: vi.fn(),
    onDelete: vi.fn(),
    onResolveToggle: vi.fn(),
    onReply: vi.fn(),
    onEdit: vi.fn(),
    onJump: vi.fn(),
  };
  render(
    <CommentSidePane comments={[]} reviewActive canAddComment {...handlers} {...props} />
  );
  return handlers;
}

describe("CommentSidePane", () => {
  it("shows a not-under-review message and disables the add toolbar", () => {
    renderPane({ reviewActive: false });
    expect(screen.getByText(/まだレビュー対象ではありません/)).toBeInTheDocument();
    expect(screen.getByTestId("editor-add-comment")).toBeDisabled();
    expect(screen.getByTestId("editor-add-global-comment")).toBeDisabled();
  });

  it("shows the empty state when under review with no comments", () => {
    renderPane();
    expect(screen.getByText(/コメントはまだありません/)).toBeInTheDocument();
    expect(screen.getByText("Comments (0/0)")).toBeInTheDocument();
  });

  it("renders each comment with body, context, scope badge", () => {
    renderPane({
      comments: [
        comment("c1", { body: "first" }),
        comment("c2", {
          scope: "global",
          anchor: undefined,
          context: null,
          body: "second",
        }),
      ],
    });
    expect(screen.getByText("Comments (2/2)")).toBeInTheDocument();
    expect(screen.getAllByTestId("comment-item")).toHaveLength(2);
    expect(screen.getByText("first")).toBeInTheDocument();
    expect(screen.getByText("second")).toBeInTheDocument();
    expect(screen.getByTestId("comment-scope-inline")).toBeInTheDocument();
    expect(screen.getByTestId("comment-scope-global")).toBeInTheDocument();
  });

  it("shows short bodies in full with no toggle", () => {
    renderPane({ comments: [comment("c1", { body: "short" })] });
    expect(screen.getByTestId("comment-body")).toHaveTextContent("short");
    expect(screen.queryByTestId("comment-body-toggle")).toBeNull();
  });

  it("truncates long bodies to a 200-char preview with an expand/collapse toggle", async () => {
    const user = userEvent.setup();
    const long = "あ".repeat(250);
    renderPane({ comments: [comment("c1", { body: long })] });

    const body = screen.getByTestId("comment-body");
    expect(body.textContent).toContain("あ".repeat(200) + "…");
    expect(body.textContent).not.toContain("あ".repeat(201));

    const toggle = screen.getByTestId("comment-body-toggle");
    expect(toggle).toHaveTextContent("続きを表示");

    await user.click(toggle);
    expect(screen.getByTestId("comment-body").textContent).toContain("あ".repeat(250));
    expect(screen.getByTestId("comment-body-toggle")).toHaveTextContent("折りたたむ");

    await user.click(screen.getByTestId("comment-body-toggle"));
    expect(screen.getByTestId("comment-body-toggle")).toHaveTextContent("続きを表示");
  });

  it("truncates long replies individually with their own toggle", async () => {
    const user = userEvent.setup();
    const longReply = "り".repeat(250);
    renderPane({
      comments: [
        comment("c1", {
          body: "short",
          replies: [
            { author: "ai", date: "2026-05-21", body: "短い返信" },
            { author: "ai", date: "2026-05-21", body: longReply },
          ],
        }),
      ],
    });

    // Short reply: no toggle. Long reply: collapsed preview + one toggle.
    const replyBodies = screen.getAllByTestId("comment-reply-body");
    expect(replyBodies).toHaveLength(2);
    expect(replyBodies[0]).toHaveTextContent("短い返信");
    expect(replyBodies[1].textContent).toContain("り".repeat(200) + "…");
    expect(replyBodies[1].textContent).not.toContain("り".repeat(201));

    const toggle = screen.getByTestId("comment-reply-body-toggle");
    await user.click(toggle);
    const expanded = screen.getAllByTestId("comment-reply-body")[1];
    expect(expanded.textContent).toContain("り".repeat(250));
    expect(screen.getByTestId("comment-reply-body-toggle")).toHaveTextContent("折りたたむ");
  });

  it("marks resolved and orphan comments", () => {
    renderPane({
      comments: [
        comment("c1", { status: "resolved" }),
        comment("c2", { orphan: true, context: null }),
      ],
    });
    expect(screen.getByText("Comments (1/2)")).toBeInTheDocument();
    expect(screen.getByTestId("comment-status-resolved")).toBeInTheDocument();
    expect(screen.getByTestId("comment-orphan")).toBeInTheDocument();
  });

  it("calls onDelete / onResolveToggle for a comment", async () => {
    const user = userEvent.setup();
    const h = renderPane({ comments: [comment("c1")] });
    await user.click(screen.getByTestId("comment-delete"));
    expect(h.onDelete).toHaveBeenCalledWith("c1");
    await user.click(screen.getByTestId("comment-resolve-toggle"));
    expect(h.onResolveToggle).toHaveBeenCalledWith("c1", "resolved");
  });

  it("disables reply and edit for a resolved comment", () => {
    renderPane({ comments: [comment("c1", { status: "resolved" })] });
    expect(screen.getByTestId("comment-reply-toggle")).toBeDisabled();
    expect(screen.getByTestId("comment-edit")).toBeDisabled();
    // reopen + delete stay enabled
    expect(screen.getByTestId("comment-resolve-toggle")).toBeEnabled();
    expect(screen.getByTestId("comment-delete")).toBeEnabled();
  });

  it("reopens a resolved comment via the toggle", async () => {
    const user = userEvent.setup();
    const h = renderPane({ comments: [comment("c1", { status: "resolved" })] });
    await user.click(screen.getByTestId("comment-resolve-toggle"));
    expect(h.onResolveToggle).toHaveBeenCalledWith("c1", "open");
  });

  it("edits a comment body", async () => {
    const user = userEvent.setup();
    const h = renderPane({ comments: [comment("c1", { body: "old body" })] });
    await user.click(screen.getByTestId("comment-edit"));
    const input = screen.getByTestId("comment-edit-input");
    await user.clear(input);
    await user.type(input, "new body");
    await user.click(screen.getByTestId("comment-edit-submit"));
    expect(h.onEdit).toHaveBeenCalledWith("c1", "new body");
  });

  it("submits a reply", async () => {
    const user = userEvent.setup();
    const h = renderPane({ comments: [comment("c1")] });
    await user.click(screen.getByTestId("comment-reply-toggle"));
    await user.type(screen.getByTestId("comment-reply-input"), "返信です");
    await user.click(screen.getByTestId("comment-reply-submit"));
    expect(h.onReply).toHaveBeenCalledWith("c1", "返信です");
  });

  it("filters the list by status via the toggle", async () => {
    const user = userEvent.setup();
    renderPane({
      comments: [
        comment("c1", { status: "open" }),
        comment("c2", { status: "resolved" }),
      ],
    });
    expect(screen.getAllByTestId("comment-item")).toHaveLength(2);
    await user.click(screen.getByTestId("comment-filter-resolved"));
    let items = screen.getAllByTestId("comment-item");
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveAttribute("data-comment-id", "c2");
    await user.click(screen.getByTestId("comment-filter-open"));
    items = screen.getAllByTestId("comment-item");
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveAttribute("data-comment-id", "c1");
  });

  it("shows the original anchored target for an orphaned comment", () => {
    renderPane({
      comments: [
        comment("c1", {
          orphan: true,
          context: null,
          anchor: {
            heading_path: ["## 認証"],
            snippet: "アクセストークン: 24 時間",
            occurrence: 0,
          },
        }),
      ],
    });
    const ctx = screen.getByTestId("comment-context-c1");
    expect(ctx).toHaveTextContent("## 認証 › アクセストークン: 24 時間");
    expect(ctx).toHaveTextContent("現在の本文には見つかりません");
  });

  it("calls onJump when the context label of an anchored comment is clicked", () => {
    const h = renderPane({ comments: [comment("c1")] });
    fireEvent.click(screen.getByTestId("comment-context-c1"));
    expect(h.onJump).toHaveBeenCalledWith("c1");
  });

  it("invokes the add-comment callbacks from the toolbar", async () => {
    const user = userEvent.setup();
    const h = renderPane();
    await user.click(screen.getByTestId("editor-add-comment"));
    await user.click(screen.getByTestId("editor-add-global-comment"));
    expect(h.onAddComment).toHaveBeenCalled();
    expect(h.onAddGlobal).toHaveBeenCalled();
  });

  it("opens a centered detail dialog and replies / resolves from it", async () => {
    const user = userEvent.setup();
    const h = renderPane({ comments: [comment("c1", { body: "detail body" })] });
    expect(screen.queryByTestId("comment-detail-dialog")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("comment-open-detail"));
    const dialog = screen.getByTestId("comment-detail-dialog");
    expect(within(dialog).getByText("detail body")).toBeInTheDocument();

    await user.type(screen.getByTestId("comment-detail-reply-input"), "見ました");
    await user.click(screen.getByTestId("comment-detail-reply-submit"));
    expect(h.onReply).toHaveBeenCalledWith("c1", "見ました");

    await user.click(screen.getByTestId("comment-detail-resolve-toggle"));
    expect(h.onResolveToggle).toHaveBeenCalledWith("c1", "resolved");
  });

  it("resolved comment's detail dialog hides the reply input", async () => {
    const user = userEvent.setup();
    renderPane({ comments: [comment("c1", { status: "resolved" })] });
    await user.click(screen.getByTestId("comment-open-detail"));
    expect(screen.getByTestId("comment-detail-dialog")).toBeInTheDocument();
    expect(screen.queryByTestId("comment-detail-reply-input")).not.toBeInTheDocument();
  });
});
