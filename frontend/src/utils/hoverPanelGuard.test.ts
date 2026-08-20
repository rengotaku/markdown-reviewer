import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HoverPanelGuard } from "./hoverPanelGuard";

const OPEN_DELAY = 150;
const CLOSE_DELAY = 250;

describe("HoverPanelGuard", () => {
  let guard: HoverPanelGuard;

  beforeEach(() => {
    vi.useFakeTimers();
    guard = new HoverPanelGuard();
  });

  afterEach(() => {
    guard.dispose();
    vi.useRealTimers();
  });

  it("opens after the delay once the pointer enters the hot zone", () => {
    const onOpen = vi.fn();
    guard.handleHotZoneEnter(OPEN_DELAY, onOpen);

    expect(onOpen).not.toHaveBeenCalled();
    vi.advanceTimersByTime(OPEN_DELAY);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("does not close while moving from the hot zone into the panel", () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    guard.handleHotZoneEnter(OPEN_DELAY, onOpen);
    vi.advanceTimersByTime(OPEN_DELAY);

    // Pointer leaves the hot zone heading toward the panel...
    guard.handleHotZoneLeave(CLOSE_DELAY, onClose);
    // ...and arrives before the close-grace timer would fire.
    guard.handlePanelEnter();
    vi.advanceTimersByTime(CLOSE_DELAY * 2);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes after the grace period once the pointer leaves both regions", () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    guard.handleHotZoneEnter(OPEN_DELAY, onOpen);
    vi.advanceTimersByTime(OPEN_DELAY);

    guard.handleHotZoneLeave(CLOSE_DELAY, onClose);
    expect(onClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(CLOSE_DELAY);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("cancels the close countdown when the pointer returns to either region during the grace period", () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    guard.handleHotZoneEnter(OPEN_DELAY, onOpen);
    vi.advanceTimersByTime(OPEN_DELAY);

    guard.handleHotZoneLeave(CLOSE_DELAY, onClose);
    vi.advanceTimersByTime(CLOSE_DELAY / 2);
    // Pointer comes back to the hot zone before the grace period elapses.
    guard.handleHotZoneEnter(OPEN_DELAY, onOpen);

    vi.advanceTimersByTime(CLOSE_DELAY);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("re-opens on a fresh hot zone entry after having closed (no reopen-suppression regression)", () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    guard.handleHotZoneEnter(OPEN_DELAY, onOpen);
    vi.advanceTimersByTime(OPEN_DELAY);
    guard.handleHotZoneLeave(CLOSE_DELAY, onClose);
    vi.advanceTimersByTime(CLOSE_DELAY);
    expect(onClose).toHaveBeenCalledTimes(1);

    guard.handleHotZoneEnter(OPEN_DELAY, onOpen);
    vi.advanceTimersByTime(OPEN_DELAY);
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("also does not close while moving from the panel back into the hot zone", () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    guard.handleHotZoneEnter(OPEN_DELAY, onOpen);
    vi.advanceTimersByTime(OPEN_DELAY);
    guard.handlePanelEnter();

    guard.handlePanelLeave(CLOSE_DELAY, onClose);
    guard.handleHotZoneEnter(OPEN_DELAY, onOpen);
    vi.advanceTimersByTime(CLOSE_DELAY * 2);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("resetRegions unsticks a region flag that never received its own leave event (#219 stuck-open bug)", () => {
    // Reproduces the bug: the hot zone element got unmounted the instant the
    // overlay opened, so its mouseleave was never delivered and
    // `overHotZone` latched `true` forever, making close impossible.
    const onOpen = vi.fn();
    const onClose = vi.fn();
    guard.handleHotZoneEnter(OPEN_DELAY, onOpen);
    vi.advanceTimersByTime(OPEN_DELAY);
    guard.handlePanelEnter();
    // No handleHotZoneLeave call here — simulating the hot zone's element
    // disappearing without ever firing its own mouseleave.

    guard.handlePanelLeave(CLOSE_DELAY, onClose);
    vi.advanceTimersByTime(CLOSE_DELAY);
    // Without the fix, overHotZone is still (wrongly) true here, so
    // scheduleCloseIfBothOut would have early-returned and this would fail.
    expect(onClose).not.toHaveBeenCalled();

    guard.resetRegions();
    guard.handlePanelLeave(CLOSE_DELAY, onClose);
    vi.advanceTimersByTime(CLOSE_DELAY);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("re-opens normally after resetRegions (no permanent suppression, mirrors the #215 reopen regression)", () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    guard.handleHotZoneEnter(OPEN_DELAY, onOpen);
    vi.advanceTimersByTime(OPEN_DELAY);
    guard.resetRegions();

    guard.handleHotZoneEnter(OPEN_DELAY, onOpen);
    vi.advanceTimersByTime(OPEN_DELAY);
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("dispose cancels pending timers", () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    guard.handleHotZoneEnter(OPEN_DELAY, onOpen);
    guard.dispose();
    vi.advanceTimersByTime(OPEN_DELAY);
    expect(onOpen).not.toHaveBeenCalled();

    guard.handleHotZoneEnter(OPEN_DELAY, onOpen);
    vi.advanceTimersByTime(OPEN_DELAY);
    guard.handleHotZoneLeave(CLOSE_DELAY, onClose);
    guard.dispose();
    vi.advanceTimersByTime(CLOSE_DELAY);
    expect(onClose).not.toHaveBeenCalled();
  });
});
