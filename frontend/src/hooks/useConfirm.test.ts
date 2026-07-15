import { describe, it, expect, beforeEach } from "vitest";
import { useConfirm } from "./useConfirm";

/**
 * FIFO queue behavior (#119 follow-up): a second confirm() firing while the
 * first is still awaiting the user must not clobber it — the classic
 * real-world trigger being the external-change watcher's dialog popping up
 * moments after a save-conflict dialog. Without a queue, `pending` (and the
 * first caller's resolver) would be silently overwritten, hanging the first
 * caller's `await confirm(...)` forever and yanking the dialog off screen
 * mid-decision.
 */
describe("useConfirm FIFO queue", () => {
  beforeEach(() => {
    useConfirm.setState({ pending: null, queue: [] });
  });

  it("keeps the first confirm() showing when a second one is queued behind it", () => {
    useConfirm.getState().confirm({ message: "first" });
    const firstPending = useConfirm.getState().pending;
    expect(firstPending?.message).toBe("first");

    useConfirm.getState().confirm({ message: "second" });

    // Queuing a second call must not replace what's on screen.
    expect(useConfirm.getState().pending?.message).toBe("first");
    expect(useConfirm.getState().pending).toBe(firstPending);
    expect(useConfirm.getState().queue).toHaveLength(2);
  });

  it("shows the second confirm() only after the first is resolved", () => {
    useConfirm.getState().confirm({ message: "first" });
    useConfirm.getState().confirm({ message: "second" });
    expect(useConfirm.getState().pending?.message).toBe("first");

    useConfirm.getState().resolve(true);

    expect(useConfirm.getState().pending?.message).toBe("second");
    expect(useConfirm.getState().queue).toHaveLength(1);
  });

  it("resolves each confirm()'s promise independently with its own answer", async () => {
    const first = useConfirm.getState().confirm({ message: "first" });
    const second = useConfirm.getState().confirm({ message: "second" });

    // Resolve the first with `true` — the second must still be pending.
    useConfirm.getState().resolve(true);
    await expect(first).resolves.toBe(true);

    // Resolve the second with `false` — independent of the first's answer.
    useConfirm.getState().resolve(false);
    await expect(second).resolves.toBe(false);

    expect(useConfirm.getState().pending).toBeNull();
    expect(useConfirm.getState().queue).toEqual([]);
  });

  it("is a no-op when resolve() is called with an empty queue", () => {
    expect(() => useConfirm.getState().resolve(true)).not.toThrow();
    expect(useConfirm.getState().pending).toBeNull();
  });

  it("does not mutate the previous queue array in place (immutability)", () => {
    useConfirm.getState().confirm({ message: "first" });
    const queueAfterFirst = useConfirm.getState().queue;

    useConfirm.getState().confirm({ message: "second" });
    const queueAfterSecond = useConfirm.getState().queue;

    expect(queueAfterFirst).not.toBe(queueAfterSecond);
    expect(queueAfterFirst).toHaveLength(1); // untouched by the later push
    expect(queueAfterSecond).toHaveLength(2);
  });
});
