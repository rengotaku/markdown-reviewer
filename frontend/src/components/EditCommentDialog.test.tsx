import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditCommentDialog } from "./EditCommentDialog";

function renderDialog(overrides: Partial<{
  open: boolean;
  scope: string;
  target: string;
  defaultBody: string;
  onClose: () => void;
  onSubmit: (body: string) => void;
}> = {}) {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  render(
    <EditCommentDialog
      open={overrides.open ?? true}
      scope={overrides.scope ?? "inline"}
      target={overrides.target ?? "hello"}
      defaultBody={overrides.defaultBody ?? "old body"}
      onClose={overrides.onClose ?? onClose}
      onSubmit={overrides.onSubmit ?? onSubmit}
    />
  );
  return { onSubmit, onClose };
}

describe("EditCommentDialog", () => {
  it("renders nothing when open=false", () => {
    renderDialog({ open: false });
    expect(screen.queryByTestId("edit-comment-body-input")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("seeds the body input from defaultBody", () => {
    renderDialog({ defaultBody: "previous text" });
    const input = screen.getByTestId("edit-comment-body-input") as HTMLInputElement;
    expect(input.value).toBe("previous text");
  });

  it("shows the target snippet for context", () => {
    renderDialog({ target: "selected target text" });
    expect(screen.getByTestId("edit-comment-target")).toHaveTextContent(
      "selected target text"
    );
  });

  it("truncates a long target with an ellipsis", () => {
    renderDialog({ target: "x".repeat(200) });
    const el = screen.getByTestId("edit-comment-target");
    expect(el.textContent ?? "").toMatch(/…$/);
    expect((el.textContent ?? "").length).toBeLessThan(200);
  });

  it("hides the target row when the target is empty (global scope)", () => {
    renderDialog({ scope: "global", target: "" });
    expect(screen.queryByTestId("edit-comment-target")).not.toBeInTheDocument();
  });

  it("disables 保存 when body is unchanged from defaultBody", () => {
    renderDialog({ defaultBody: "same" });
    const submit = screen.getByTestId("edit-comment-submit");
    expect(submit).toBeDisabled();
  });

  it("disables 保存 when body is blank", async () => {
    const user = userEvent.setup();
    renderDialog({ defaultBody: "starting" });
    const input = screen.getByTestId("edit-comment-body-input");
    await user.clear(input);
    const submit = screen.getByTestId("edit-comment-submit");
    expect(submit).toBeDisabled();
  });

  it("calls onSubmit with the trimmed new body", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderDialog({ defaultBody: "old" });
    const input = screen.getByTestId("edit-comment-body-input");
    await user.clear(input);
    await user.type(input, "  new body  ");
    await user.click(screen.getByTestId("edit-comment-submit"));
    expect(onSubmit).toHaveBeenCalledWith("new body");
  });

  it("calls onClose when キャンセル is pressed", async () => {
    const user = userEvent.setup();
    const { onClose, onSubmit } = renderDialog();
    await user.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(onClose).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("titles the dialog with the (humanized) scope label", () => {
    renderDialog({ scope: "cross-section" });
    expect(screen.getByRole("dialog")).toHaveTextContent("コメントを編集（横断）");
  });
});
