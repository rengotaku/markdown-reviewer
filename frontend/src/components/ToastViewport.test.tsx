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

  // #178 round 5 (codex review, must-fix): re-showing an identical
  // message+severity collapses into the same queue slot with a new id
  // (useToast) — this remounts the Snackbar here (`key={current?.id}`),
  // which is what actually resets autoHideDuration so a repeated "Saved"
  // toast doesn't vanish 5s after the *first* click while the user keeps
  // clicking Save.
  it("remounts the Snackbar under a new key when an identical toast is re-shown", () => {
    render(<ToastViewport />);
    act(() => {
      useToast.getState().show("「edit-me.md」を保存しました", "success");
    });
    const firstAlert = screen.getByRole("alert");
    const firstId = useToast.getState().toasts[0].id;

    act(() => {
      useToast.getState().show("「edit-me.md」を保存しました", "success");
    });

    // Same queue slot (still exactly one toast, same text) but a genuinely
    // new DOM node — proof the Snackbar remounted rather than just having
    // its text silently stay the same underneath an untouched timer.
    expect(useToast.getState().toasts).toHaveLength(1);
    expect(useToast.getState().toasts[0].id).not.toBe(firstId);
    const secondAlert = screen.getByRole("alert");
    expect(secondAlert).toHaveTextContent("「edit-me.md」を保存しました");
    expect(secondAlert).not.toBe(firstAlert);
  });
});
