import { describe, it, expect } from "vitest";
import {
  popoverFrame,
  POPOVER_MAX_HEIGHT,
  POPOVER_MIN_HEIGHT,
} from "./popoverFrame";

const VIEWPORT = 1000;

/** An anchor of the given height whose top sits at `top`. */
function anchor(top: number, height = 20) {
  return { top, bottom: top + height };
}

describe("popoverFrame", () => {
  it("has no frame without an anchor", () => {
    expect(popoverFrame(null, VIEWPORT)).toEqual({
      placement: "bottom-start",
      maxHeight: 0,
    });
  });

  it("opens downwards past the middle of the viewport, where there is more room above", () => {
    // below = 1000 - 540 - 16 = 444, above = 504. The roomier side is up, but
    // the card fits below and belongs next to the anchor. This is what #284
    // got wrong.
    const frame = popoverFrame(anchor(520), VIEWPORT);
    expect(frame.placement).toBe("bottom-start");
    expect(frame.maxHeight).toBe(POPOVER_MAX_HEIGHT);
  });

  it("still opens downwards when the room below only fits a short card", () => {
    // below = 1000 - 744 - 16 = 240 — exactly a usable card — vs 708 above.
    const frame = popoverFrame(anchor(724), VIEWPORT);
    expect(frame.placement).toBe("bottom-start");
    expect(frame.maxHeight).toBe(POPOVER_MIN_HEIGHT);
  });

  it("flips up once the room below cannot hold a usable card", () => {
    // below = 239, above = 709
    const frame = popoverFrame(anchor(725), VIEWPORT);
    expect(frame.placement).toBe("top-start");
    expect(frame.maxHeight).toBe(POPOVER_MAX_HEIGHT);
  });

  it("stays down when neither side is usable but below is roomier", () => {
    // below = 1000 - 830 - 16 = 154, above = 130 - 16 = 114
    const frame = popoverFrame({ top: 130, bottom: 830 }, VIEWPORT);
    expect(frame.placement).toBe("bottom-start");
    expect(frame.maxHeight).toBe(POPOVER_MIN_HEIGHT);
  });

  it("caps the card at the room the chosen side actually offers", () => {
    // below = 1000 - 850 - 16 = 134, above = 700 - 16 = 684 → up, capped at
    // the ceiling rather than the full 684.
    const frame = popoverFrame({ top: 700, bottom: 850 }, VIEWPORT);
    expect(frame.placement).toBe("top-start");
    expect(frame.maxHeight).toBe(POPOVER_MAX_HEIGHT);
  });

  it("keeps a floor under the height when both sides are cramped", () => {
    // A tall anchor filling the viewport: below = -6, above = 4.
    const frame = popoverFrame({ top: 20, bottom: 990 }, VIEWPORT);
    expect(frame.maxHeight).toBe(POPOVER_MIN_HEIGHT);
  });

  it("reports a partial ceiling between the floor and the cap", () => {
    // below = 1000 - 700 - 16 = 284
    expect(popoverFrame({ top: 100, bottom: 700 }, VIEWPORT)).toEqual({
      placement: "bottom-start",
      maxHeight: 284,
    });
  });
});
