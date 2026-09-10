import { describe, it, expect } from "vitest";
import { layoutCommentRail, type RailItem } from "./commentRailLayout";

// Pane sits with its own top at viewport y=100 and is 600px tall, so anchors
// at 100..700 (viewport-absolute) are the ones actually inside the pane.
const VIEWPORT = { paneTop: 100, paneHeight: 600 };

function item(id: string, anchorTop: number | null, height: number, order: number): RailItem {
  return { id, anchorTop, height, order };
}

describe("layoutCommentRail", () => {
  it("1. orders cards by document order (order), not input order", () => {
    const items = [
      item("c", 500, 40, 2),
      item("a", 200, 40, 0),
      item("b", 350, 40, 1),
    ];
    const result = layoutCommentRail(items, VIEWPORT);
    expect(result.visible.map((v) => v.id)).toEqual(["a", "b", "c"]);
  });

  it("2. overlapping cards are pushed down to previous top + height + gap", () => {
    // a: anchor 150 → top 50 (150-100), height 40 → occupies 50..90.
    // b: anchor 160 (relative 60) overlaps a's box (50..90) → pushed to
    //    90 + 8 = 98.
    const items = [item("a", 150, 40, 0), item("b", 160, 40, 1)];
    const result = layoutCommentRail(items, VIEWPORT);
    const a = result.visible.find((v) => v.id === "a")!;
    const b = result.visible.find((v) => v.id === "b")!;
    expect(a.top).toBe(50);
    expect(b.top).toBe(a.top + 40 + 8);
  });

  it("3. anchors only slightly above the pane clamp to top 0, and consecutive ones stack from there", () => {
    // Both anchors sit above paneTop=100 (relative anchor negative), but only
    // by less than their own height (40) — a small overshoot, not a card
    // scrolled fully out of view (that's case 5) — so both still clamp to 0
    // and stack.
    const items = [item("a", 80, 40, 0), item("b", 90, 40, 1)];
    const result = layoutCommentRail(items, VIEWPORT);
    const a = result.visible.find((v) => v.id === "a")!;
    const b = result.visible.find((v) => v.id === "b")!;
    expect(a.top).toBe(0);
    expect(b.top).toBe(40 + 8);
    expect(result.aboveCount).toBe(0);
  });

  it("4. a card that doesn't fit before the pane's bottom is not rendered and counts as belowCount", () => {
    // a fits at top 0..560. b's natural anchor (relative 580) would need
    // 580..620, past paneHeight=600.
    const items = [item("a", 100, 560, 0), item("b", 680, 40, 1)];
    const result = layoutCommentRail(items, VIEWPORT);
    expect(result.visible.map((v) => v.id)).toEqual(["a"]);
    expect(result.belowCount).toBe(1);
    expect(result.aboveCount).toBe(0);
  });

  it("5. a card scrolled fully above the pane is dropped straight to aboveCount, without clamping/stacking in front of cards actually on screen", () => {
    // a: relative -20 (paneTop=100 → anchorTop=80), height 40 — only
    //    partially above (case 3's small-overshoot territory) → clamps to
    //    top 0 and stacks normally.
    // b: relative -500, height 280 — its whole box sits above the pane
    //    (relativeAnchor <= -height) → must NOT clamp to 0 and steal the
    //    rail from a paragraph that's actually visible; counts as
    //    aboveCount and leaves `cursor` untouched.
    // c: relative 200, height 40 — comfortably inside the pane; must land
    //    at its own anchor (200), not get pushed down by b piling onto 0.
    const items = [
      item("a", 80, 40, 0),
      item("b", -400, 280, 1),
      item("c", 300, 40, 2),
    ];
    const result = layoutCommentRail(items, VIEWPORT);
    expect(result.visible).toEqual([
      { id: "a", top: 0, maxHeight: 40 },
      { id: "c", top: 200, maxHeight: 40 },
    ]);
    expect(result.aboveCount).toBe(1);
    expect(result.belowCount).toBe(0);
  });

  it("6. cards with anchorTop null are excluded, not counted in visible/above/below", () => {
    const items = [item("a", 100, 40, 0), item("orphan", null, 40, 1)];
    const result = layoutCommentRail(items, VIEWPORT);
    expect(result.visible.map((v) => v.id)).toEqual(["a"]);
    expect(result.excluded).toEqual(["orphan"]);
    expect(result.aboveCount).toBe(0);
    expect(result.belowCount).toBe(0);
  });

  it("7. empty input returns zeroed counts without throwing", () => {
    expect(() => layoutCommentRail([], VIEWPORT)).not.toThrow();
    const result = layoutCommentRail([], VIEWPORT);
    expect(result).toEqual({ visible: [], aboveCount: 0, belowCount: 0, excluded: [] });
  });

  it("8. a lone card taller than the pane is placed at top 0 and shrunk to the pane's height", () => {
    // 900px is already clamped to RAIL_CARD_MAX_HEIGHT (320) before it ever
    // reaches the pane check, so the pane itself has to be shorter than that
    // for a lone card to still overflow it.
    const shortPane = { paneTop: 100, paneHeight: 200 };
    const items = [item("a", 100, 900, 0)];
    const result = layoutCommentRail(items, shortPane);
    expect(result.visible).toEqual([{ id: "a", top: 0, maxHeight: 200 }]);
    expect(result.aboveCount).toBe(0);
    expect(result.belowCount).toBe(0);
  });
});
