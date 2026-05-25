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

  it("cross-section mode: shows empty-state hint when no H1/H2 headings exist", () => {
    render(
      <AddCommentDialog
        open
        mode="cross-section"
        targetSnippet=""
        headings={[]}
        onClose={() => {}}
        onSubmit={() => {}}
      />
    );
    expect(screen.getByTestId("comment-sections-picker")).toBeInTheDocument();
    expect(screen.getByTestId("comment-no-headings-hint")).toBeInTheDocument();
  });

  it("cross-section mode: requires ≥1 section and submits sections[]", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <AddCommentDialog
        open
        mode="cross-section"
        targetSnippet=""
        headings={[
          { level: 1, text: "Top" },
          { level: 2, text: "Problem" },
          { level: 2, text: "Try" },
          { level: 2, text: "Action" },
        ]}
        onClose={() => {}}
        onSubmit={onSubmit}
      />
    );

    await user.type(screen.getByTestId("comment-body-input"), "cross note");

    // Body filled but no section selected → submit still disabled.
    expect(screen.getByTestId("comment-submit")).toBeDisabled();

    await user.click(screen.getByTestId("comment-section-1")); // Problem
    await user.click(screen.getByTestId("comment-section-2")); // Try
    expect(screen.getByTestId("comment-submit")).toBeEnabled();
    await user.click(screen.getByTestId("comment-submit"));

    expect(onSubmit).toHaveBeenCalledWith({
      body: "cross note",
      scope: "cross-section",
      sections: ["Problem", "Try"],
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
});
