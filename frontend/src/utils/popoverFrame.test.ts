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

  it("opens downwards when the card fits below, even with more room above", () => {
    // below = 1000 - 540 - 16 = 444 (fits) vs above = 504 — the roomier side
    // is up, but the card has no reason to leave the anchor. This is what
    // #284 got wrong.
    const frame = popoverFrame(anchor(520), VIEWPORT);
    expect(frame.placement).toBe("bottom-start");
    expect(frame.maxHeight).toBe(POPOVER_MAX_HEIGHT);
  });

  it("opens downwards with exactly enough room below", () => {
    // bottom = 544 → below = 1000 - 544 - 16 = 440
    expect(popoverFrame(anchor(524), VIEWPORT).placement).toBe("bottom-start");
  });

  it("flips up when the card cannot fit below and there is more room above", () => {
    // bottom = 545 → below = 439, above = 509
    const frame = popoverFrame(anchor(525), VIEWPORT);
    expect(frame.placement).toBe("top-start");
    expect(frame.maxHeight).toBe(POPOVER_MAX_HEIGHT);
  });

  it("stays down when neither side fits but below is roomier", () => {
    // below = 1000 - 700 - 16 = 284, above = 100 - 16 = 84
    const frame = popoverFrame({ top: 100, bottom: 700 }, VIEWPORT);
    expect(frame.placement).toBe("bottom-start");
    expect(frame.maxHeight).toBe(284);
  });

  it("reports the real room of the side it picked", () => {
    // below = 284, above = 384 — neither fits, so the roomier side wins and
    // the card is capped at what that side actually offers.
    const frame = popoverFrame({ top: 400, bottom: 700 }, VIEWPORT);
    expect(frame.placement).toBe("top-start");
    expect(frame.maxHeight).toBe(384);
  });

  it("keeps a floor under the height when both sides are cramped", () => {
    // A tall anchor filling the viewport: below = -6, above = 4.
    const frame = popoverFrame({ top: 20, bottom: 990 }, VIEWPORT);
    expect(frame.maxHeight).toBe(POPOVER_MIN_HEIGHT);
  });
});
