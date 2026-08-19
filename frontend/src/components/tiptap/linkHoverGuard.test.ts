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

  it("does not suppress reopening when the pointer already left the anchor before closing (grace-timeout close)", () => {
    // Regression: closing via the close-grace countdown (or Esc/"Open"
    // after the pointer already moved away) must not suppress the next
    // genuine re-hover — only closing *while still hovering* should.
    const guard = new LinkHoverGuard();
    const onOpen = vi.fn();
    const a = anchor();

    guard.handleMouseOver(a, DELAY, onOpen);
    vi.advanceTimersByTime(DELAY);
    expect(onOpen).toHaveBeenCalledTimes(1);

    // Pointer leaves the anchor before the preview is closed (e.g. moved
    // toward empty space, never onto the card).
    guard.handleMouseOut(a);
    // The preview closes afterward (grace countdown elapsing, or Esc/close
    // button/"Open" pressed once the pointer is no longer over the anchor).
    guard.handleClose();

    const scheduled = guard.handleMouseOver(a, DELAY, onOpen);
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

describe("LinkHoverGuard — hover card stay area (#215)", () => {
  const CLOSE_GRACE = 250;

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("closes after the grace period once the pointer leaves the anchor with no card involved", () => {
    const guard = new LinkHoverGuard();
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const a = anchor();

    guard.handleMouseOver(a, DELAY, onOpen);
    vi.advanceTimersByTime(DELAY);

    guard.handleMouseOut(a, CLOSE_GRACE, onClose);
    expect(onClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(CLOSE_GRACE);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close when the pointer moves from the anchor onto the card before the grace elapses", () => {
    const guard = new LinkHoverGuard();
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const a = anchor();

    guard.handleMouseOver(a, DELAY, onOpen);
    vi.advanceTimersByTime(DELAY);

    guard.handleMouseOut(a, CLOSE_GRACE, onClose);
    vi.advanceTimersByTime(CLOSE_GRACE - 50);
    guard.handleCardMouseEnter();
    vi.advanceTimersByTime(CLOSE_GRACE);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes after the grace period once the pointer leaves the card too", () => {
    const guard = new LinkHoverGuard();
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const a = anchor();

    guard.handleMouseOver(a, DELAY, onOpen);
    vi.advanceTimersByTime(DELAY);
    guard.handleMouseOut(a, CLOSE_GRACE, onClose);
    guard.handleCardMouseEnter();
    vi.advanceTimersByTime(CLOSE_GRACE);
    expect(onClose).not.toHaveBeenCalled();

    guard.handleCardMouseLeave(CLOSE_GRACE, onClose);
    expect(onClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(CLOSE_GRACE);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("re-entering the anchor cancels a close countdown started by leaving the card", () => {
    const guard = new LinkHoverGuard();
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const a = anchor();

    guard.handleMouseOver(a, DELAY, onOpen);
    vi.advanceTimersByTime(DELAY);
    guard.handleCardMouseEnter();
    guard.handleCardMouseLeave(CLOSE_GRACE, onClose);

    vi.advanceTimersByTime(CLOSE_GRACE - 50);
    guard.handleMouseOver(a, DELAY, onOpen);
    vi.advanceTimersByTime(CLOSE_GRACE);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("reopens on re-hover after the grace-close callback (handleClose) fires while the pointer is over neither anchor nor card", () => {
    // End-to-end regression for the real TiptapEditor wiring: `onClose` is
    // always `closePreview`, which calls `handleClose()`. Verifies that
    // path — not just a manually-invoked `handleClose()` — doesn't leave a
    // stale suppression behind once the countdown actually elapses.
    const guard = new LinkHoverGuard();
    const onOpen = vi.fn();
    const a = anchor();
    const onClose = () => guard.handleClose();

    guard.handleMouseOver(a, DELAY, onOpen);
    vi.advanceTimersByTime(DELAY);
    guard.handleMouseOut(a, CLOSE_GRACE, onClose);
    vi.advanceTimersByTime(CLOSE_GRACE);

    const scheduled = guard.handleMouseOver(a, DELAY, onOpen);
    expect(scheduled).toBe(true);
    vi.advanceTimersByTime(DELAY);
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("dispose cancels a pending close countdown", () => {
    const guard = new LinkHoverGuard();
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const a = anchor();

    guard.handleMouseOver(a, DELAY, onOpen);
    vi.advanceTimersByTime(DELAY);
    guard.handleMouseOut(a, CLOSE_GRACE, onClose);
    guard.dispose();
    vi.advanceTimersByTime(CLOSE_GRACE);
    expect(onClose).not.toHaveBeenCalled();
  });
});
