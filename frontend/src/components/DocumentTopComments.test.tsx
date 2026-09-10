import { describe, it, expect, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DocumentTopComments } from "./DocumentTopComments";
import type { CommentJSON } from "@/api";

// #309: the pane's old pinned section (全体・位置不明) moved to the top of
// the document body. This file carries over the CommentRow interaction
// coverage that used to exercise that section inside CommentSidePane.test.tsx
// (reply / edit / resolve / delete / detail dialog / markdown rendering) —
// the component under test changed, the assertions didn't.

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

/** A comment with no live anchor — the fixture DocumentTopComments exists
 *  for. */
const pinned = (id: string, overrides: Partial<CommentJSON> = {}): CommentJSON =>
  comment(id, { scope: "global", context: null, anchor: undefined, ...overrides });

function renderTop(props: Partial<React.ComponentProps<typeof DocumentTopComments>> = {}) {
  const handlers = {
    onDelete: vi.fn(),
    onResolveToggle: vi.fn(),
    onReply: vi.fn(),
    onEdit: vi.fn(),
    onEditReply: vi.fn(),
    onDeleteReply: vi.fn(),
  };
  render(
    <DocumentTopComments
      root="works"
      filePath="doc.md"
      comments={[]}
      {...handlers}
      {...props}
    />
  );
  return handlers;
}

describe("DocumentTopComments", () => {
  it("renders nothing when there are no global/orphan comments", () => {
    renderTop({ comments: [comment("c1")] });
    expect(screen.queryByTestId("document-top-comments")).toBeNull();
  });

  it("renders only the global/orphan subset, not anchored comments", () => {
    renderTop({ comments: [comment("c1"), pinned("g1")] });
    const items = screen.getAllByTestId("comment-item");
    expect(items).toHaveLength(1);
    expect(within(items[0]).getByTestId("comment-id")).toHaveTextContent("g1");
  });

  it("shows the original anchored target for an orphaned comment", () => {
    renderTop({
      comments: [
        pinned("c1", {
          scope: "block",
          orphan: true,
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

  it("shows original targets for an orphan with multiple anchors, without heading", () => {
    renderTop({
      comments: [
        pinned("c1", {
          scope: "block",
          orphan: true,
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

  it("lists the leading anchor too when a multi-line inline comment goes orphan", () => {
    // #162: the first selected block lives in `anchor`, the rest in `anchors`.
    // Taking `anchors` alone would hide the block the selection started on.
    renderTop({
      comments: [
        pinned("c1", {
          scope: "inline",
          orphan: true,
          anchor: { heading_path: ["## 実績"], snippet: "先頭ブロック", occurrence: 0 },
          anchors: [{ heading_path: ["## 実績"], snippet: "後続ブロック", occurrence: 0 }],
        }),
      ],
    });
    const ctx = screen.getByTestId("comment-context-c1");
    expect(ctx).toHaveTextContent("## 実績 › 先頭ブロック / ## 実績 › 後続ブロック");
    expect(ctx).toHaveTextContent("現在の本文には見つかりません");
  });

  it("shows 位置不明 for an orphan without any stored anchor", () => {
    renderTop({
      comments: [pinned("c1", { scope: "block", orphan: true, anchor: undefined })],
    });
    expect(screen.getByTestId("comment-context-c1")).toHaveTextContent("位置不明 (orphan)");
  });

  it("clamps long replies individually with their own toggle, without slicing the source", async () => {
    const user = userEvent.setup();
    const longReply = "り".repeat(250);
    renderTop({
      comments: [
        pinned("c1", {
          body: "short",
          replies: [
            { author: "ai", date: "2026-05-21", body: "短い返信" },
            { author: "ai", date: "2026-05-21", body: longReply },
          ],
        }),
      ],
    });

    // Short reply: no toggle. Long reply: clamped + one toggle, full text
    // still present in the DOM.
    const replyBodies = screen.getAllByTestId("comment-reply-body");
    expect(replyBodies).toHaveLength(2);
    expect(replyBodies[0]).toHaveTextContent("短い返信");
    expect(replyBodies[1].textContent).toContain("り".repeat(250));
    expect(replyBodies[1]).toHaveAttribute("data-collapsed", "true");

    const toggle = screen.getByTestId("comment-reply-body-toggle");
    await user.click(toggle);
    const expanded = screen.getAllByTestId("comment-reply-body")[1];
    expect(expanded.textContent).toContain("り".repeat(250));
    expect(expanded).toHaveAttribute("data-collapsed", "false");
    expect(screen.getByTestId("comment-reply-body-toggle")).toHaveTextContent("折りたたむ");
  });

  it("marks resolved and orphan comments", async () => {
    renderTop({
      comments: [
        pinned("c1", { status: "resolved" }),
        pinned("c2", { orphan: true, context: null }),
      ],
    });
    expect(screen.getByTestId("comment-status-resolved")).toBeInTheDocument();
    expect(screen.getByTestId("comment-orphan")).toBeInTheDocument();
  });

  it("calls onDelete / onResolveToggle for a comment", async () => {
    const user = userEvent.setup();
    const h = renderTop({ comments: [pinned("c1")] });
    await user.click(screen.getByTestId("comment-delete"));
    expect(h.onDelete).toHaveBeenCalledWith("c1");
    await user.click(screen.getByTestId("comment-resolve-toggle"));
    expect(h.onResolveToggle).toHaveBeenCalledWith("c1", "resolved");
  });

  it("disables reply and edit for a resolved comment", async () => {
    renderTop({ comments: [pinned("c1", { status: "resolved" })] });
    expect(screen.getByTestId("comment-reply-toggle")).toBeDisabled();
    expect(screen.getByTestId("comment-edit")).toBeDisabled();
    // reopen + delete stay enabled
    expect(screen.getByTestId("comment-resolve-toggle")).toBeEnabled();
    expect(screen.getByTestId("comment-delete")).toBeEnabled();
  });

  it("disables edit/delete for an AI-authored comment but keeps reply/resolve enabled", () => {
    renderTop({ comments: [pinned("c1", { author: "ai", status: "open" })] });
    expect(screen.getByTestId("comment-edit")).toBeDisabled();
    expect(screen.getByTestId("comment-delete")).toBeDisabled();
    expect(screen.getByTestId("comment-reply-toggle")).toBeEnabled();
    expect(screen.getByTestId("comment-resolve-toggle")).toBeEnabled();
  });

  it("keeps edit/delete enabled for a human-authored comment", () => {
    renderTop({ comments: [pinned("c1", { author: "reviewer", status: "open" })] });
    expect(screen.getByTestId("comment-edit")).toBeEnabled();
    expect(screen.getByTestId("comment-delete")).toBeEnabled();
  });

  it("disables edit/delete for an AI-authored reply but keeps human replies editable", () => {
    renderTop({
      comments: [
        pinned("c1", {
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

  it("reopens a resolved comment via the toggle", async () => {
    const user = userEvent.setup();
    const h = renderTop({ comments: [pinned("c1", { status: "resolved" })] });
    await user.click(screen.getByTestId("comment-resolve-toggle"));
    expect(h.onResolveToggle).toHaveBeenCalledWith("c1", "open");
  });

  it("edits a comment body", async () => {
    const user = userEvent.setup();
    const h = renderTop({ comments: [pinned("c1", { body: "old body" })] });
    await user.click(screen.getByTestId("comment-edit"));
    const input = screen.getByTestId("comment-edit-input");
    await user.clear(input);
    await user.type(input, "new body");
    await user.click(screen.getByTestId("comment-edit-submit"));
    expect(h.onEdit).toHaveBeenCalledWith("c1", "new body");
  });

  it("submits a reply", async () => {
    const user = userEvent.setup();
    const h = renderTop({ comments: [pinned("c1")] });
    await user.click(screen.getByTestId("comment-reply-toggle"));
    await user.type(screen.getByTestId("comment-reply-input"), "返信です");
    await user.click(screen.getByTestId("comment-reply-submit"));
    expect(h.onReply).toHaveBeenCalledWith("c1", "返信です");
  });

  it("edits an individual reply by its index", async () => {
    const user = userEvent.setup();
    const h = renderTop({
      comments: [
        pinned("c1", {
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
    const h = renderTop({
      comments: [
        pinned("c1", {
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

  it("disables per-reply edit/delete for a resolved comment", async () => {
    renderTop({
      comments: [
        pinned("c1", {
          status: "resolved",
          replies: [{ author: "ai", date: "2026-05-20", body: "reply0" }],
        }),
      ],
    });
    expect(screen.getByTestId("comment-reply-edit")).toBeDisabled();
    expect(screen.getByTestId("comment-reply-delete")).toBeDisabled();
  });

  it("opens a centered detail dialog and replies / resolves from it", async () => {
    const user = userEvent.setup();
    const h = renderTop({ comments: [pinned("c1", { body: "detail body" })] });
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
    renderTop({ comments: [pinned("c1", { status: "resolved" })] });
    await user.click(screen.getByTestId("comment-open-detail"));
    expect(screen.getByTestId("comment-detail-dialog")).toBeInTheDocument();
    expect(screen.queryByTestId("comment-detail-reply-input")).not.toBeInTheDocument();
  });

  it("cancels an inline edit without calling onEdit", async () => {
    const user = userEvent.setup();
    const h = renderTop({ comments: [pinned("c1", { body: "original" })] });
    await user.click(screen.getByTestId("comment-edit"));
    await user.type(screen.getByTestId("comment-edit-input"), " extra");
    await user.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(h.onEdit).not.toHaveBeenCalled();
    expect(screen.queryByTestId("comment-edit-input")).not.toBeInTheDocument();
    expect(screen.getByTestId("comment-body")).toHaveTextContent("original");
  });

  it("submitting an unchanged edit just closes the editor without onEdit", async () => {
    const user = userEvent.setup();
    const h = renderTop({ comments: [pinned("c1", { body: "same body" })] });
    await user.click(screen.getByTestId("comment-edit"));
    await user.click(screen.getByTestId("comment-edit-submit"));
    expect(h.onEdit).not.toHaveBeenCalled();
    expect(screen.queryByTestId("comment-edit-input")).not.toBeInTheDocument();
  });

  it("cancels a reply draft without calling onReply", async () => {
    const user = userEvent.setup();
    const h = renderTop({ comments: [pinned("c1")] });
    await user.click(screen.getByTestId("comment-reply-toggle"));
    await user.type(screen.getByTestId("comment-reply-input"), "下書き");
    await user.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(h.onReply).not.toHaveBeenCalled();
    expect(screen.queryByTestId("comment-reply-input")).not.toBeInTheDocument();
  });

  it("detail dialog shows the full reply thread", async () => {
    const user = userEvent.setup();
    renderTop({
      comments: [
        pinned("c1", {
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
    const h = renderTop({ comments: [pinned("c1", { body: "old" })] });
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
    const h = renderTop({ comments: [pinned("c1", { body: "keep me" })] });
    await user.click(screen.getByTestId("comment-open-detail"));
    await user.click(screen.getByTestId("comment-detail-edit"));
    await user.click(screen.getByTestId("comment-detail-edit-submit"));
    expect(h.onEdit).not.toHaveBeenCalled();
    expect(screen.queryByTestId("comment-detail-edit-input")).not.toBeInTheDocument();
  });

  it("cancels a detail edit without calling onEdit", async () => {
    const user = userEvent.setup();
    const h = renderTop({ comments: [pinned("c1", { body: "old" })] });
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
    const h = renderTop({ comments: [pinned("c1")] });
    await user.click(screen.getByTestId("comment-open-detail"));
    await user.click(screen.getByTestId("comment-detail-delete"));
    expect(h.onDelete).toHaveBeenCalledWith("c1");
    await waitFor(() =>
      expect(screen.queryByTestId("comment-detail-dialog")).not.toBeInTheDocument()
    );
  });

  it("closes the detail dialog via 閉じる", async () => {
    const user = userEvent.setup();
    renderTop({ comments: [pinned("c1")] });
    await user.click(screen.getByTestId("comment-open-detail"));
    await user.click(screen.getByRole("button", { name: "閉じる" }));
    await waitFor(() =>
      expect(screen.queryByTestId("comment-detail-dialog")).not.toBeInTheDocument()
    );
  });

  it("disables edit/delete in the detail dialog for an AI-authored comment", async () => {
    const user = userEvent.setup();
    renderTop({ comments: [pinned("c1", { author: "ai", status: "open" })] });
    await user.click(screen.getByTestId("comment-open-detail"));
    expect(screen.getByTestId("comment-detail-edit")).toBeDisabled();
    expect(screen.getByTestId("comment-detail-delete")).toBeDisabled();
  });

  it("reopens a resolved comment from the detail dialog", async () => {
    const user = userEvent.setup();
    const h = renderTop({ comments: [pinned("c1", { status: "resolved" })] });
    await user.click(screen.getByTestId("comment-open-detail"));
    await user.click(screen.getByTestId("comment-detail-resolve-toggle"));
    expect(h.onResolveToggle).toHaveBeenCalledWith("c1", "open");
  });

  it("B3: renders inline code in a reply body", () => {
    renderTop({
      comments: [
        pinned("c1", {
          replies: [{ author: "reviewer", date: "2026-05-21", body: "`code`" }],
        }),
      ],
    });
    const replyBody = screen.getByTestId("comment-reply-body");
    expect(replyBody.querySelector("code")).not.toBeNull();
  });

  it("B6: editing a human comment's body shows the raw Markdown source, not rendered text", async () => {
    const user = userEvent.setup();
    renderTop({
      comments: [pinned("c1", { author: "reviewer", body: "**強調** テキスト" })],
    });
    await user.click(screen.getByTestId("comment-edit"));
    const input = screen.getByTestId("comment-edit-input") as HTMLTextAreaElement;
    expect(input.value).toBe("**強調** テキスト");
  });

  it("B7: a comment row has a comment-header containing the author", () => {
    renderTop({ comments: [pinned("c1", { author: "alice" })] });
    const header = screen.getByTestId("comment-header");
    expect(header).toHaveTextContent("alice");
  });

  it("B8: a reply row has a comment-reply-header", () => {
    renderTop({
      comments: [
        pinned("c1", {
          replies: [{ author: "reviewer", date: "2026-05-21", body: "reply" }],
        }),
      ],
    });
    expect(screen.getByTestId("comment-reply-header")).toBeInTheDocument();
  });

  it("ケース 2: リンクコピー: 詳細ダイアログ", async () => {
    const user = userEvent.setup();
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: {
        writeText: writeTextMock,
      },
    });

    renderTop({
      root: "code",
      filePath: "foo.md",
      comments: [pinned("c-001")],
    });

    const openDetailBtn = screen.getByTestId("comment-open-detail");
    await user.click(openDetailBtn);

    const dialog = screen.getByTestId("comment-detail-dialog");
    const dialogCopyBtn = within(dialog).getByTestId("comment-detail-copy-link");
    await user.click(dialogCopyBtn);

    expect(writeTextMock).toHaveBeenCalledTimes(1);
    const copiedUrl = writeTextMock.mock.calls[0][0];
    expect(copiedUrl).toContain("/code/foo.md");
    expect(copiedUrl).toContain("comment_id=c-001");

    vi.unstubAllGlobals();
  });
});
