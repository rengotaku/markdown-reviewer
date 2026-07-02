import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastViewport } from "./ToastViewport";
import { useToast } from "@/hooks/useToast";

describe("ToastViewport", () => {
  beforeEach(() => {
    useToast.setState({ toasts: [] });
  });

  it("renders nothing when no toast is queued", () => {
    render(<ToastViewport />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the first queued toast with its severity", () => {
    render(<ToastViewport />);
    act(() => {
      useToast.getState().show("保存しました", "success");
    });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("保存しました");
    expect(alert.className).toContain("MuiAlert-filledSuccess");
  });

  it("dismisses the toast via the close button, revealing the next one", async () => {
    const user = userEvent.setup();
    render(<ToastViewport />);
    act(() => {
      useToast.getState().show("first");
      useToast.getState().show("second");
    });
    expect(screen.getByRole("alert")).toHaveTextContent("first");

    await user.click(screen.getByTitle("Close"));
    expect(useToast.getState().toasts.map((t) => t.message)).toEqual(["second"]);
  });

  it("runs the action and dismisses when the action button is clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<ToastViewport />);
    act(() => {
      useToast.getState().show("新しいファイルを検出", "info", {
        action: { label: "開く", onClick },
      });
    });

    await user.click(screen.getByTestId("toast-action"));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(useToast.getState().toasts).toHaveLength(0);
  });
});
