import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
    onAddCrossSection: vi.fn(),
    onDelete: vi.fn(),
    onResolveToggle: vi.fn(),
    onReply: vi.fn(),
    onJump: vi.fn(),
  };
  render(
    <CommentSidePane
      comments={[]}
      reviewActive
      canAddComment
      {...handlers}
      {...props}
    />
  );
  return handlers;
}

describe("CommentSidePane", () => {
  it("shows a not-under-review message and disables the add toolbar", () => {
    renderPane({ reviewActive: false });
    expect(
      screen.getByText(/まだレビュー対象ではありません/)
    ).toBeInTheDocument();
    expect(screen.getByTestId("editor-add-comment")).toBeDisabled();
    expect(screen.getByTestId("editor-add-global-comment")).toBeDisabled();
  });

  it("shows the empty state when under review with no comments", () => {
    renderPane();
    expect(
      screen.getByText(/コメントはまだありません/)
    ).toBeInTheDocument();
    expect(screen.getByText("Comments (0/0)")).toBeInTheDocument();
  });

  it("renders each comment with body, context, scope badge", () => {
    renderPane({
      comments: [
        comment("c1", { body: "first" }),
        comment("c2", { scope: "global", anchor: undefined, context: null, body: "second" }),
      ],
    });
    expect(screen.getByText("Comments (2/2)")).toBeInTheDocument();
    expect(screen.getAllByTestId("comment-item")).toHaveLength(2);
    expect(screen.getByText("first")).toBeInTheDocument();
    expect(screen.getByText("second")).toBeInTheDocument();
    expect(screen.getByTestId("comment-scope-inline")).toBeInTheDocument();
    expect(screen.getByTestId("comment-scope-global")).toBeInTheDocument();
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

  it("reopens a resolved comment via the toggle", async () => {
    const user = userEvent.setup();
    const h = renderPane({ comments: [comment("c1", { status: "resolved" })] });
    await user.click(screen.getByTestId("comment-resolve-toggle"));
    expect(h.onResolveToggle).toHaveBeenCalledWith("c1", "open");
  });

  it("submits a reply", async () => {
    const user = userEvent.setup();
    const h = renderPane({ comments: [comment("c1")] });
    await user.click(screen.getByTestId("comment-reply-toggle"));
    await user.type(screen.getByTestId("comment-reply-input"), "返信です");
    await user.click(screen.getByTestId("comment-reply-submit"));
    expect(h.onReply).toHaveBeenCalledWith("c1", "返信です");
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
    await user.click(screen.getByTestId("editor-add-cross-section-comment"));
    expect(h.onAddComment).toHaveBeenCalled();
    expect(h.onAddGlobal).toHaveBeenCalled();
    expect(h.onAddCrossSection).toHaveBeenCalled();
  });
});
