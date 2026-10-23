import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GlobalCommentsDialog } from "./GlobalCommentsDialog";
import type { CommentJSON } from "@/api";

const comment = (id: string, overrides: Partial<CommentJSON> = {}): CommentJSON => ({
  id,
  scope: "global",
  author: "alice",
  date: "2026-05-20",
  body: `body of ${id}`,
  status: "open",
  anchor: undefined,
  context: null,
  orphan: false,
  ...overrides,
});

function renderDialog(props: Partial<React.ComponentProps<typeof GlobalCommentsDialog>> = {}) {
  const handlers = {
    onClose: vi.fn(),
    onDelete: vi.fn(),
    onResolveToggle: vi.fn(),
    onReply: vi.fn(),
    onEdit: vi.fn(),
    onEditReply: vi.fn(),
    onDeleteReply: vi.fn(),
    onCopyLink: vi.fn(),
    onAddGlobal: vi.fn(),
  };
  render(
    <GlobalCommentsDialog
      open
      initialTab="global"
      globalComments={[]}
      orphanComments={[]}
      {...handlers}
      {...props}
    />
  );
  return handlers;
}

describe("GlobalCommentsDialog", () => {
  it("shows the comment body of the initial tab's list", () => {
    renderDialog({ globalComments: [comment("g1", { body: "global body" })] });
    expect(screen.getByText("global body")).toBeInTheDocument();
  });

  it("shows tabs only when both global and orphan comments exist", () => {
    renderDialog({
      globalComments: [comment("g1")],
      orphanComments: [comment("o1", { orphan: true, scope: "inline" })],
    });
    expect(screen.getByTestId("global-comments-tab-global")).toBeInTheDocument();
    expect(screen.getByTestId("global-comments-tab-orphan")).toBeInTheDocument();
  });

  it("does not show tabs when only one kind exists", () => {
    renderDialog({ globalComments: [comment("g1")] });
    expect(screen.queryByTestId("global-comments-tab-global")).toBeNull();
    expect(screen.queryByTestId("global-comments-tab-orphan")).toBeNull();
  });

  it("calls onReply with the id and body when replying inside the dialog", async () => {
    const user = userEvent.setup();
    const handlers = renderDialog({ globalComments: [comment("g1")] });
    await user.click(screen.getByTestId("comment-reply-toggle"));
    await user.type(screen.getByTestId("comment-reply-input"), "my reply");
    await user.click(screen.getByTestId("comment-reply-submit"));
    expect(handlers.onReply).toHaveBeenCalledWith("g1", "my reply");
  });

  it("switches the visible list when a different tab is selected", async () => {
    const user = userEvent.setup();
    renderDialog({
      globalComments: [comment("g1", { body: "global body" })],
      orphanComments: [comment("o1", { orphan: true, scope: "inline", body: "orphan body" })],
      initialTab: "global",
    });
    expect(screen.getByText("global body")).toBeInTheDocument();
    expect(screen.queryByText("orphan body")).toBeNull();
    await user.click(screen.getByTestId("global-comments-tab-orphan"));
    expect(screen.getByText("orphan body")).toBeInTheDocument();
    expect(screen.queryByText("global body")).toBeNull();
  });

  it("initializes on the orphan tab when opened from the orphan badge", () => {
    renderDialog({
      globalComments: [comment("g1", { body: "global body" })],
      orphanComments: [comment("o1", { orphan: true, scope: "inline", body: "orphan body" })],
      initialTab: "orphan",
    });
    expect(screen.getByText("orphan body")).toBeInTheDocument();
    expect(screen.queryByText("global body")).toBeNull();
  });

  it("hides the open-detail button (this dialog is already the centered view)", () => {
    renderDialog();
    expect(screen.queryByTestId("comment-open-detail")).toBeNull();
  });

  it("calls onAddGlobal and closes when the footer button is clicked", async () => {
    const user = userEvent.setup();
    const handlers = renderDialog();
    await user.click(screen.getByTestId("global-comments-dialog-add"));
    expect(handlers.onAddGlobal).toHaveBeenCalledTimes(1);
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });
});
