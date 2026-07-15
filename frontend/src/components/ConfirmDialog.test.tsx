import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDialog } from "./ConfirmDialog";
import { useConfirm } from "@/hooks/useConfirm";

describe("ConfirmDialog", () => {
  beforeEach(() => {
    useConfirm.setState({ pending: null, queue: [] });
  });

  it("stays closed while nothing is pending", () => {
    render(<ConfirmDialog />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens with the requested texts and resolves true on confirm", async () => {
    const user = userEvent.setup();
    render(<ConfirmDialog />);
    let result: Promise<boolean>;
    act(() => {
      result = useConfirm.getState().confirm({
        title: "破棄の確認",
        message: "未保存の変更を破棄しますか？",
        confirmLabel: "破棄",
        cancelLabel: "やめる",
      });
    });

    expect(screen.getByRole("dialog")).toHaveTextContent("破棄の確認");
    expect(screen.getByText("未保存の変更を破棄しますか？")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "破棄" }));
    await expect(result!).resolves.toBe(true);
    expect(useConfirm.getState().pending).toBeNull();
  });

  it("resolves false on cancel and applies default labels", async () => {
    const user = userEvent.setup();
    render(<ConfirmDialog />);
    let result: Promise<boolean>;
    act(() => {
      result = useConfirm.getState().confirm({ message: "続行しますか？" });
    });

    // Defaults: title 確認 / OK / キャンセル
    expect(screen.getByRole("dialog")).toHaveTextContent("確認");
    await user.click(screen.getByRole("button", { name: "キャンセル" }));
    await expect(result!).resolves.toBe(false);
  });
});
