import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LinkHoverGuard } from "./linkHoverGuard";

const DELAY = 300;

function anchor(): HTMLAnchorElement {
  return document.createElement("a");
}

describe("LinkHoverGuard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens after the hover delay", () => {
    const guard = new LinkHoverGuard();
    const onOpen = vi.fn();
    const a = anchor();

    guard.handleMouseOver(a, DELAY, onOpen);
    expect(onOpen).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DELAY);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("cancels the pending open if the pointer leaves before the delay", () => {
    const guard = new LinkHoverGuard();
    const onOpen = vi.fn();
    const a = anchor();

    guard.handleMouseOver(a, DELAY, onOpen);
    guard.handleMouseOut(a);
    vi.advanceTimersByTime(DELAY);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("does not reopen the same anchor right after close while still hovering it", () => {
    const guard = new LinkHoverGuard();
    const onOpen = vi.fn();
    const a = anchor();

    // First hover opens the preview.
    guard.handleMouseOver(a, DELAY, onOpen);
    vi.advanceTimersByTime(DELAY);
    expect(onOpen).toHaveBeenCalledTimes(1);

    // User closes it (Esc/backdrop/close button) — pointer never left `a`,
    // so no intervening mouseout fires. A synthetic mouseover re-delivered
    // by the browser once the overlay unmounts must not reopen it.
    guard.handleClose();
    const scheduled = guard.handleMouseOver(a, DELAY, onOpen);
    expect(scheduled).toBe(false);
    vi.advanceTimersByTime(DELAY);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("allows reopening the same anchor once the pointer actually leaves and returns", () => {
    const guard = new LinkHoverGuard();
    const onOpen = vi.fn();
    const a = anchor();

    guard.handleMouseOver(a, DELAY, onOpen);
    vi.advanceTimersByTime(DELAY);
    guard.handleClose();

    // Pointer genuinely leaves the anchor, then comes back.
    guard.handleMouseOut(a);
    const scheduled = guard.handleMouseOver(a, DELAY, onOpen);
    expect(scheduled).toBe(true);
    vi.advanceTimersByTime(DELAY);
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("does not suppress hovering a different anchor after closing", () => {
    const guard = new LinkHoverGuard();
    const onOpen = vi.fn();
    const a = anchor();
    const b = anchor();

    guard.handleMouseOver(a, DELAY, onOpen);
    vi.advanceTimersByTime(DELAY);
    guard.handleClose();

    const scheduled = guard.handleMouseOver(b, DELAY, onOpen);
    expect(scheduled).toBe(true);
    vi.advanceTimersByTime(DELAY);
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("dispose cancels a pending timer without touching suppression state", () => {
    const guard = new LinkHoverGuard();
    const onOpen = vi.fn();
    const a = anchor();

    guard.handleMouseOver(a, DELAY, onOpen);
    guard.dispose();
    vi.advanceTimersByTime(DELAY);
    expect(onOpen).not.toHaveBeenCalled();
  });
});
