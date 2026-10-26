import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommentComposerPopover } from "./CommentComposerPopover";

function setup(initialDraft = "") {
  const onDraftChange = vi.fn();
  const onSubmit = vi.fn();
  const utils = render(
    <CommentComposerPopover
      mode="anchored"
      targetSnippet="対象の段落"
      maxHeight={440}
      initialDraft={initialDraft}
      onDraftChange={onDraftChange}
      onSubmit={onSubmit}
      onCancel={vi.fn()}
    />
  );
  return { ...utils, onDraftChange, onSubmit };
}

describe("CommentComposerPopover", () => {
  // #357: the composer owns the text, so typing doesn't depend on the caller
  // feeding each keystroke back as a prop.
  it("keeps what is typed without the caller passing it back", async () => {
    const user = userEvent.setup();
    const { onDraftChange } = setup();

    await user.type(screen.getByTestId("comment-body-input"), "ここ直して");

    expect(screen.getByTestId("comment-body-input")).toHaveValue("ここ直して");
    expect(onDraftChange).toHaveBeenLastCalledWith("ここ直して");
    expect(screen.getByTestId("comment-submit")).toBeEnabled();
  });

  it("starts from initialDraft and submits the trimmed body", async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup("  下書き ");

    expect(screen.getByTestId("comment-body-input")).toHaveValue("  下書き ");
    await user.click(screen.getByTestId("comment-submit"));

    expect(onSubmit).toHaveBeenCalledWith({ body: "下書き", scope: "inline" });
  });

  it("starts over from the new initialDraft when remounted with a new key", async () => {
    const user = userEvent.setup();
    const props = {
      mode: "anchored" as const,
      targetSnippet: "",
      maxHeight: 440,
      onDraftChange: vi.fn(),
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
    };
    const { rerender } = render(<CommentComposerPopover key={1} initialDraft="" {...props} />);
    await user.type(screen.getByTestId("comment-body-input"), "前の入力");

    rerender(<CommentComposerPopover key={2} initialDraft="" {...props} />);

    expect(screen.getByTestId("comment-body-input")).toHaveValue("");
  });
});
