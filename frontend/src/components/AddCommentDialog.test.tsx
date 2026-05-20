import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AddCommentDialog } from "./AddCommentDialog";

describe("AddCommentDialog", () => {
  it("renders nothing visible when open=false", () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    render(
      <AddCommentDialog
        open={false}
        targetSnippet="hello"
        onClose={onClose}
        onSubmit={onSubmit}
      />
    );

    // Dialog body should not be mounted.
    expect(screen.queryByTestId("comment-target-snippet")).not.toBeInTheDocument();
    expect(screen.queryByTestId("comment-body-input")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("displays the target snippet", () => {
    render(
      <AddCommentDialog
        open
        targetSnippet="This is the selected text"
        onClose={() => {}}
        onSubmit={() => {}}
      />
    );

    const snippet = screen.getByTestId("comment-target-snippet");
    expect(snippet).toHaveTextContent("This is the selected text");
  });

  it("truncates a long snippet with an ellipsis", () => {
    const long = "a".repeat(200);
    render(
      <AddCommentDialog
        open
        targetSnippet={long}
        onClose={() => {}}
        onSubmit={() => {}}
      />
    );

    const snippet = screen.getByTestId("comment-target-snippet");
    // SNIPPET_LIMIT is 80 → truncated text + ellipsis.
    expect(snippet.textContent ?? "").toMatch(/…$/);
    expect((snippet.textContent ?? "").length).toBeLessThan(long.length);
  });

  it("shows a placeholder when target snippet is empty", () => {
    render(
      <AddCommentDialog
        open
        targetSnippet=""
        onClose={() => {}}
        onSubmit={() => {}}
      />
    );

    expect(screen.getByTestId("comment-target-snippet")).toHaveTextContent(
      "(範囲が選択されていません)"
    );
  });

  it("disables the submit button when body is empty or whitespace", async () => {
    const user = userEvent.setup();
    render(
      <AddCommentDialog
        open
        targetSnippet="snip"
        onClose={() => {}}
        onSubmit={() => {}}
      />
    );

    const submit = screen.getByTestId("comment-submit");
    expect(submit).toBeDisabled();

    // Whitespace only should still keep submit disabled.
    const input = screen.getByTestId("comment-body-input");
    await user.type(input, "   ");
    expect(submit).toBeDisabled();
  });

  it("enables submit once body has non-whitespace content", async () => {
    const user = userEvent.setup();
    render(
      <AddCommentDialog
        open
        targetSnippet="snip"
        onClose={() => {}}
        onSubmit={() => {}}
      />
    );

    const submit = screen.getByTestId("comment-submit");
    const input = screen.getByTestId("comment-body-input");
    await user.type(input, "hello");
    expect(submit).toBeEnabled();
  });

  it("calls onSubmit with trimmed body when submit is clicked", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <AddCommentDialog
        open
        targetSnippet="snip"
        onClose={() => {}}
        onSubmit={onSubmit}
      />
    );

    const input = screen.getByTestId("comment-body-input");
    await user.type(input, "  my comment  ");
    await user.click(screen.getByTestId("comment-submit"));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ body: "my comment" });
  });

  it("prefills the body input with defaultBody", () => {
    render(
      <AddCommentDialog
        open
        targetSnippet="snip"
        defaultBody="preset text"
        onClose={() => {}}
        onSubmit={() => {}}
      />
    );

    const input = screen.getByTestId("comment-body-input") as HTMLTextAreaElement;
    expect(input.value).toBe("preset text");
    expect(screen.getByTestId("comment-submit")).toBeEnabled();
  });

  it("calls onClose when the cancel button is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <AddCommentDialog
        open
        targetSnippet="snip"
        onClose={onClose}
        onSubmit={() => {}}
      />
    );

    await user.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
