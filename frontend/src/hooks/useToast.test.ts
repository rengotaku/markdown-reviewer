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

  // #178 round 5 (codex review, must-fix — real-browser regression): a save
  // toast fired once per click used to queue one entry per click, so the
  // popup kept reappearing for `5s × click count` after the user stopped
  // clicking. Repeat action-less notifications now collapse into the same
  // queue slot instead of piling up.
  it("collapses 5 identical show() calls (same message + severity) into a single queued toast", () => {
    for (let i = 0; i < 5; i++) {
      useToast.getState().show("「edit-me.md」を保存しました", "success");
    }
    expect(useToast.getState().toasts).toHaveLength(1);
  });

  it("re-shows the same message+severity by swapping the existing toast's id, keeping its queue position", () => {
    useToast.getState().show("before", "info");
    useToast.getState().show("「edit-me.md」を保存しました", "success");
    useToast.getState().show("after", "info");

    const before = useToast.getState().toasts;
    expect(before.map((t) => t.message)).toEqual([
      "before",
      "「edit-me.md」を保存しました",
      "after",
    ]);
    const originalId = before[1].id;

    useToast.getState().show("「edit-me.md」を保存しました", "success");

    const after = useToast.getState().toasts;
    // Same length, same order — only the middle entry's id changed.
    expect(after.map((t) => t.message)).toEqual([
      "before",
      "「edit-me.md」を保存しました",
      "after",
    ]);
    expect(after[1].id).not.toBe(originalId);
    expect(after[0].id).toBe(before[0].id);
    expect(after[2].id).toBe(before[2].id);
  });

  it("queues a toast with a different message separately, even with the same severity", () => {
    useToast.getState().show("saved a.md", "success");
    useToast.getState().show("saved b.md", "success");
    expect(useToast.getState().toasts).toHaveLength(2);
  });

  it("queues a toast with a different severity separately, even with the same message", () => {
    useToast.getState().show("same text", "success");
    useToast.getState().show("same text", "error");
    expect(useToast.getState().toasts).toHaveLength(2);
  });

  it("does not collapse an actioned toast into an identical action-less one, or vice versa", () => {
    const onClick = vi.fn();
    useToast.getState().show("新しいファイルを検出", "info");
    useToast.getState().show("新しいファイルを検出", "info", {
      action: { label: "開く", onClick },
    });
    expect(useToast.getState().toasts).toHaveLength(2);

    // And the reverse order: an actioned toast already queued must not
    // absorb a later action-less duplicate either.
    useToast.setState({ toasts: [] });
    useToast.getState().show("新しいファイルを検出", "info", {
      action: { label: "開く", onClick },
    });
    useToast.getState().show("新しいファイルを検出", "info");
    expect(useToast.getState().toasts).toHaveLength(2);
  });
});
