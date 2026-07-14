import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
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
    onRefresh: vi.fn(),
    onAddComment: vi.fn(),
    onAddGlobal: vi.fn(),
    onDelete: vi.fn(),
    onResolveToggle: vi.fn(),
    onReply: vi.fn(),
    onEdit: vi.fn(),
    onEditReply: vi.fn(),
    onDeleteReply: vi.fn(),
    onJump: vi.fn(),
  };
  render(
    <CommentSidePane comments={[]} reviewActive canAddComment {...handlers} {...props} />
  );
  return handlers;
}

describe("CommentSidePane", () => {
  it("shows a not-under-review message but keeps the add toolbar clickable to prompt ingest", async () => {
    const user = userEvent.setup();
    const handlers = renderPane({ reviewActive: false });
    expect(screen.getByText(/まだレビュー対象ではありません/)).toBeInTheDocument();
    // The buttons stay enabled so the click reaches the parent, which shows the
    // "取り込む" prompt instead of silently doing nothing.
    expect(screen.getByTestId("editor-add-comment")).not.toBeDisabled();
    expect(screen.getByTestId("editor-add-global-comment")).not.toBeDisabled();
    await user.click(screen.getByTestId("editor-add-comment"));
    expect(handlers.onAddComment).toHaveBeenCalledTimes(1);
    await user.click(screen.getByTestId("editor-add-global-comment"));
    expect(handlers.onAddGlobal).toHaveBeenCalledTimes(1);
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

  it("disables edit/delete for an AI-authored comment but keeps reply/resolve enabled", () => {
    renderPane({ comments: [comment("c1", { author: "ai", status: "open" })] });
    expect(screen.getByTestId("comment-edit")).toBeDisabled();
    expect(screen.getByTestId("comment-delete")).toBeDisabled();
    expect(screen.getByTestId("comment-reply-toggle")).toBeEnabled();
    expect(screen.getByTestId("comment-resolve-toggle")).toBeEnabled();
  });

  it("keeps edit/delete enabled for a human-authored comment", () => {
    renderPane({ comments: [comment("c1", { author: "reviewer", status: "open" })] });
    expect(screen.getByTestId("comment-edit")).toBeEnabled();
    expect(screen.getByTestId("comment-delete")).toBeEnabled();
  });

  it("disables edit/delete for an AI-authored reply but keeps human replies editable", () => {
    renderPane({
      comments: [
        comment("c1", {
          replies: [
            { author: "ai", date: "2026-05-20", body: "ai reply" },
            { author: "reviewer", date: "2026-05-21", body: "human reply" },
          ],
        }),
      ],
    });
    const editButtons = screen.getAllByTestId("comment-reply-edit");
    const deleteButtons = screen.getAllByTestId("comment-reply-delete");
    expect(editButtons[0]).toBeDisabled();
    expect(deleteButtons[0]).toBeDisabled();
    expect(editButtons[1]).toBeEnabled();
    expect(deleteButtons[1]).toBeEnabled();
  });

  it("calls onRefresh when the refresh button is clicked", async () => {
    const user = userEvent.setup();
    const h = renderPane();
    await user.click(screen.getByTestId("comment-pane-refresh"));
    expect(h.onRefresh).toHaveBeenCalledTimes(1);
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

  it("edits an individual reply by its index", async () => {
    const user = userEvent.setup();
    const h = renderPane({
      comments: [
        comment("c1", {
          replies: [
            { author: "reviewer", date: "2026-05-20", body: "reply0" },
            { author: "reviewer", date: "2026-05-21", body: "reply1" },
          ],
        }),
      ],
    });
    // Each reply has its own edit button; operate on the second one (index 1).
    const editButtons = screen.getAllByTestId("comment-reply-edit");
    expect(editButtons).toHaveLength(2);
    await user.click(editButtons[1]);
    const input = screen.getByTestId("comment-reply-edit-input");
    await user.clear(input);
    await user.type(input, "reply1-edited");
    await user.click(screen.getByTestId("comment-reply-edit-submit"));
    expect(h.onEditReply).toHaveBeenCalledWith("c1", 1, "reply1-edited");
  });

  it("deletes an individual reply by its index", async () => {
    const user = userEvent.setup();
    const h = renderPane({
      comments: [
        comment("c1", {
          replies: [
            { author: "reviewer", date: "2026-05-20", body: "reply0" },
            { author: "reviewer", date: "2026-05-21", body: "reply1" },
          ],
        }),
      ],
    });
    const deleteButtons = screen.getAllByTestId("comment-reply-delete");
    await user.click(deleteButtons[0]);
    expect(h.onDeleteReply).toHaveBeenCalledWith("c1", 0);
  });

  it("disables per-reply edit/delete for a resolved comment", () => {
    renderPane({
      comments: [
        comment("c1", {
          status: "resolved",
          replies: [{ author: "ai", date: "2026-05-20", body: "reply0" }],
        }),
      ],
    });
    expect(screen.getByTestId("comment-reply-edit")).toBeDisabled();
    expect(screen.getByTestId("comment-reply-delete")).toBeDisabled();
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

  it("closes the pane via the header button", async () => {
    const user = userEvent.setup();
    const h = renderPane();
    await user.click(screen.getByTestId("comment-pane-close"));
    expect(h.onClose).toHaveBeenCalled();
  });

  it("labels a multi-anchor (cross-section) comment with its heading names", () => {
    renderPane({
      comments: [
        comment("c1", {
          scope: "cross_section",
          anchor: undefined,
          context: null,
          anchors: [
            { heading_path: ["# 認証", "## トークン"], snippet: "s1", occurrence: 0 },
            { heading_path: ["# 認証", "## エラー"], snippet: "s2", occurrence: 0 },
          ],
        }),
      ],
    });
    expect(screen.getByTestId("comment-context-c1")).toHaveTextContent(
      "対象: ## トークン ・ ## エラー"
    );
  });

  it("falls back to the anchor snippet when no live context is resolved", () => {
    renderPane({
      comments: [
        comment("c1", {
          context: null,
          anchor: { heading_path: [], snippet: "生スニペット", occurrence: 0 },
        }),
      ],
    });
    expect(screen.getByTestId("comment-context-c1")).toHaveTextContent("対象: 生スニペット");
  });

  it("shows original targets for an orphan with multiple anchors, without heading", () => {
    renderPane({
      comments: [
        comment("c1", {
          orphan: true,
          context: null,
          anchor: undefined,
          anchors: [
            { heading_path: ["## A"], snippet: "s1", occurrence: 0 },
            { heading_path: [], snippet: "s2", occurrence: 0 },
          ],
        }),
      ],
    });
    const ctx = screen.getByTestId("comment-context-c1");
    expect(ctx).toHaveTextContent("## A › s1 / s2");
    expect(ctx).toHaveTextContent("現在の本文には見つかりません");
  });

  it("shows 位置不明 for an orphan without any stored anchor", () => {
    renderPane({
      comments: [comment("c1", { orphan: true, context: null, anchor: undefined })],
    });
    expect(screen.getByTestId("comment-context-c1")).toHaveTextContent("位置不明 (orphan)");
  });

  it("cancels an inline edit without calling onEdit", async () => {
    const user = userEvent.setup();
    const h = renderPane({ comments: [comment("c1", { body: "original" })] });
    await user.click(screen.getByTestId("comment-edit"));
    await user.type(screen.getByTestId("comment-edit-input"), " extra");
    await user.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(h.onEdit).not.toHaveBeenCalled();
    expect(screen.queryByTestId("comment-edit-input")).not.toBeInTheDocument();
    expect(screen.getByTestId("comment-body")).toHaveTextContent("original");
  });

  it("submitting an unchanged edit just closes the editor without onEdit", async () => {
    const user = userEvent.setup();
    const h = renderPane({ comments: [comment("c1", { body: "same body" })] });
    await user.click(screen.getByTestId("comment-edit"));
    await user.click(screen.getByTestId("comment-edit-submit"));
    expect(h.onEdit).not.toHaveBeenCalled();
    expect(screen.queryByTestId("comment-edit-input")).not.toBeInTheDocument();
  });

  it("cancels a reply draft without calling onReply", async () => {
    const user = userEvent.setup();
    const h = renderPane({ comments: [comment("c1")] });
    await user.click(screen.getByTestId("comment-reply-toggle"));
    await user.type(screen.getByTestId("comment-reply-input"), "下書き");
    await user.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(h.onReply).not.toHaveBeenCalled();
    expect(screen.queryByTestId("comment-reply-input")).not.toBeInTheDocument();
  });

  it("detail dialog shows the full reply thread", async () => {
    const user = userEvent.setup();
    renderPane({
      comments: [
        comment("c1", {
          replies: [
            { author: "ai", date: "2026-05-21", body: "一次回答" },
            { body: "追記" },
          ],
        }),
      ],
    });
    await user.click(screen.getByTestId("comment-open-detail"));
    const replies = screen.getAllByTestId("comment-detail-reply");
    expect(replies).toHaveLength(2);
    expect(replies[0]).toHaveTextContent("一次回答");
    expect(replies[1]).toHaveTextContent("追記");
  });

  it("edits the comment body from the detail dialog", async () => {
    const user = userEvent.setup();
    const h = renderPane({ comments: [comment("c1", { body: "old" })] });
    await user.click(screen.getByTestId("comment-open-detail"));
    await user.click(screen.getByTestId("comment-detail-edit"));
    const input = screen.getByTestId("comment-detail-edit-input");
    await user.clear(input);
    await user.type(input, "detail edited");
    await user.click(screen.getByTestId("comment-detail-edit-submit"));
    expect(h.onEdit).toHaveBeenCalledWith("c1", "detail edited");
    expect(screen.queryByTestId("comment-detail-edit-input")).not.toBeInTheDocument();
  });

  it("detail edit submit with unchanged body closes without onEdit", async () => {
    const user = userEvent.setup();
    const h = renderPane({ comments: [comment("c1", { body: "keep me" })] });
    await user.click(screen.getByTestId("comment-open-detail"));
    await user.click(screen.getByTestId("comment-detail-edit"));
    await user.click(screen.getByTestId("comment-detail-edit-submit"));
    expect(h.onEdit).not.toHaveBeenCalled();
    expect(screen.queryByTestId("comment-detail-edit-input")).not.toBeInTheDocument();
  });

  it("cancels a detail edit without calling onEdit", async () => {
    const user = userEvent.setup();
    const h = renderPane({ comments: [comment("c1", { body: "old" })] });
    await user.click(screen.getByTestId("comment-open-detail"));
    await user.click(screen.getByTestId("comment-detail-edit"));
    await user.type(screen.getByTestId("comment-detail-edit-input"), " more");
    const dialog = screen.getByTestId("comment-detail-dialog");
    await user.click(within(dialog).getByRole("button", { name: "キャンセル" }));
    expect(h.onEdit).not.toHaveBeenCalled();
    expect(screen.queryByTestId("comment-detail-edit-input")).not.toBeInTheDocument();
  });

  it("deletes from the detail dialog and closes it", async () => {
    const user = userEvent.setup();
    const h = renderPane({ comments: [comment("c1")] });
    await user.click(screen.getByTestId("comment-open-detail"));
    await user.click(screen.getByTestId("comment-detail-delete"));
    expect(h.onDelete).toHaveBeenCalledWith("c1");
    await waitFor(() =>
      expect(screen.queryByTestId("comment-detail-dialog")).not.toBeInTheDocument()
    );
  });

  it("jumps from the detail dialog's context label and closes it", async () => {
    const user = userEvent.setup();
    const h = renderPane({ comments: [comment("c1")] });
    await user.click(screen.getByTestId("comment-open-detail"));
    const dialog = screen.getByTestId("comment-detail-dialog");
    await user.click(within(dialog).getByText(/対象:/));
    expect(h.onJump).toHaveBeenCalledWith("c1");
    await waitFor(() =>
      expect(screen.queryByTestId("comment-detail-dialog")).not.toBeInTheDocument()
    );
  });

  it("closes the detail dialog via 閉じる", async () => {
    const user = userEvent.setup();
    renderPane({ comments: [comment("c1")] });
    await user.click(screen.getByTestId("comment-open-detail"));
    await user.click(screen.getByRole("button", { name: "閉じる" }));
    await waitFor(() =>
      expect(screen.queryByTestId("comment-detail-dialog")).not.toBeInTheDocument()
    );
  });

  it("disables edit/delete in the detail dialog for an AI-authored comment", async () => {
    const user = userEvent.setup();
    renderPane({ comments: [comment("c1", { author: "ai", status: "open" })] });
    await user.click(screen.getByTestId("comment-open-detail"));
    expect(screen.getByTestId("comment-detail-edit")).toBeDisabled();
    expect(screen.getByTestId("comment-detail-delete")).toBeDisabled();
  });

  it("reopens a resolved comment from the detail dialog", async () => {
    const user = userEvent.setup();
    const h = renderPane({ comments: [comment("c1", { status: "resolved" })] });
    await user.click(screen.getByTestId("comment-open-detail"));
    await user.click(screen.getByTestId("comment-detail-resolve-toggle"));
    expect(h.onResolveToggle).toHaveBeenCalledWith("c1", "open");
  });
});
