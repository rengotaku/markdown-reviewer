import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useHoverPanel } from "./useHoverPanel";

describe("useHoverPanel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls onOpen after hovering the hot zone", () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const { result } = renderHook(() => useHoverPanel({ onOpen, onClose }));

    result.current.hotZoneHandlers.onMouseEnter();
    vi.runAllTimers();

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does nothing when disabled (pinned sidebar)", () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const { result } = renderHook(() =>
      useHoverPanel({ onOpen, onClose, disabled: true })
    );

    result.current.hotZoneHandlers.onMouseEnter();
    vi.runAllTimers();

    expect(onOpen).not.toHaveBeenCalled();
  });

  it("disposes the guard on unmount without throwing", () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const { result, unmount } = renderHook(() => useHoverPanel({ onOpen, onClose }));

    result.current.hotZoneHandlers.onMouseEnter();
    unmount();
    vi.runAllTimers();

    expect(onOpen).not.toHaveBeenCalled();
  });
});
