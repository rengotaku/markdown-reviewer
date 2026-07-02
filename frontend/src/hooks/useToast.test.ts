import { describe, it, expect, beforeEach, vi } from "vitest";
import { useToast } from "./useToast";

describe("useToast", () => {
  beforeEach(() => {
    useToast.setState({ toasts: [] });
  });

  it("queues a toast with the default info severity", () => {
    useToast.getState().show("hello");
    const toasts = useToast.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ message: "hello", severity: "info" });
    expect(toasts[0].action).toBeUndefined();
  });

  it("queues toasts in order with unique ids", () => {
    useToast.getState().show("first", "success");
    useToast.getState().show("second", "error");
    const [a, b] = useToast.getState().toasts;
    expect(a.message).toBe("first");
    expect(b.message).toBe("second");
    expect(a.id).not.toBe(b.id);
  });

  it("carries an optional action", () => {
    const onClick = vi.fn();
    useToast.getState().show("open it", "info", { action: { label: "開く", onClick } });
    const t = useToast.getState().toasts[0];
    expect(t.action?.label).toBe("開く");
    t.action?.onClick();
    expect(onClick).toHaveBeenCalled();
  });

  it("dismiss removes only the matching toast", () => {
    useToast.getState().show("keep");
    useToast.getState().show("drop");
    const drop = useToast.getState().toasts[1];
    useToast.getState().dismiss(drop.id);
    const remaining = useToast.getState().toasts;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].message).toBe("keep");
  });
});
