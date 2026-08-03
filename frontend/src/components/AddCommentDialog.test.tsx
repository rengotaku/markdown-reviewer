import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AddCommentDialog } from "./AddCommentDialog";
import { useConfirm } from "@/hooks/useConfirm";

describe("AddCommentDialog", () => {
  beforeEach(() => {
    useConfirm.setState({ pending: null, queue: [] });
  });

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
      "(対象が指定されていません)"
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

  it("anchored mode: no scope radio, submits scope=inline", async () => {
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

    expect(screen.queryByTestId("comment-scope-group")).not.toBeInTheDocument();

    const input = screen.getByTestId("comment-body-input");
    await user.type(input, "  my comment  ");
    await user.click(screen.getByTestId("comment-submit"));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ body: "my comment", scope: "inline" });
  });

  it("block mode: shows the block target, no scope radio, submits scope=block", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <AddCommentDialog
        open
        mode="block"
        targetSnippet="The whole block paragraph contents."
        onClose={() => {}}
        onSubmit={onSubmit}
      />
    );

    expect(screen.getByTestId("comment-target-snippet")).toHaveTextContent(
      "The whole block paragraph contents."
    );
    expect(screen.queryByTestId("comment-scope-group")).not.toBeInTheDocument();

    await user.type(screen.getByTestId("comment-body-input"), "block note");
    await user.click(screen.getByTestId("comment-submit"));

    expect(onSubmit).toHaveBeenCalledWith({
      body: "block note",
      scope: "block",
    });
  });

  it("global mode: no target snippet, no scope radio, submits scope=global", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <AddCommentDialog
        open
        mode="global"
        targetSnippet=""
        onClose={() => {}}
        onSubmit={onSubmit}
      />
    );

    expect(screen.queryByTestId("comment-target-snippet")).not.toBeInTheDocument();
    expect(screen.queryByTestId("comment-scope-group")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("comment-sections-picker")
    ).not.toBeInTheDocument();

    await user.type(screen.getByTestId("comment-body-input"), "file-wide note");
    await user.click(screen.getByTestId("comment-submit"));

    expect(onSubmit).toHaveBeenCalledWith({
      body: "file-wide note",
      scope: "global",
    });
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

  it("body has content + backdrop click → shows a discard confirmation and does not close", async () => {
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

    await user.type(screen.getByTestId("comment-body-input"), "wip");

    // MUI Dialog portals into document.body, not the render() container.
    const backdrop = document.body.querySelector(".MuiBackdrop-root");
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop as Element);

    await waitFor(() => expect(useConfirm.getState().pending).not.toBeNull());
    expect(useConfirm.getState().pending?.title).toBe(
      "コメントを破棄しますか？"
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("declining the discard confirmation keeps the dialog open with the input intact", async () => {
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

    await user.type(screen.getByTestId("comment-body-input"), "wip");
    fireEvent.click(
      document.body.querySelector(".MuiBackdrop-root") as Element
    );
    await waitFor(() => expect(useConfirm.getState().pending).not.toBeNull());

    act(() => useConfirm.getState().resolve(false));

    await waitFor(() => expect(useConfirm.getState().pending).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
    expect(
      (screen.getByTestId("comment-body-input") as HTMLTextAreaElement).value
    ).toBe("wip");
  });

  it("body has content + Escape key → shows a confirmation, accepting closes", async () => {
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

    const input = screen.getByTestId("comment-body-input");
    await user.type(input, "wip");
    await user.type(input, "{Escape}");

    await waitFor(() => expect(useConfirm.getState().pending).not.toBeNull());

    act(() => useConfirm.getState().resolve(true));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("body has content + cancel button → shows a confirmation, accepting closes", async () => {
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

    await user.type(screen.getByTestId("comment-body-input"), "wip");
    await user.click(screen.getByRole("button", { name: "キャンセル" }));

    await waitFor(() => expect(useConfirm.getState().pending).not.toBeNull());
    expect(onClose).not.toHaveBeenCalled();

    act(() => useConfirm.getState().resolve(true));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("empty body + backdrop click → closes immediately without a confirmation", async () => {
    const onClose = vi.fn();
    render(
      <AddCommentDialog
        open
        targetSnippet="snip"
        onClose={onClose}
        onSubmit={() => {}}
      />
    );

    fireEvent.click(
      document.body.querySelector(".MuiBackdrop-root") as Element
    );

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(useConfirm.getState().pending).toBeNull();
  });

  it("empty body + cancel button → closes immediately without a confirmation", async () => {
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
    expect(useConfirm.getState().pending).toBeNull();
  });

  it("whitespace-only body + cancel button → closes immediately without a confirmation", async () => {
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

    await user.type(screen.getByTestId("comment-body-input"), "   ");
    await user.click(screen.getByRole("button", { name: "キャンセル" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(useConfirm.getState().pending).toBeNull();
  });
});
