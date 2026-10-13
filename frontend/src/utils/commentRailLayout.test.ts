import { describe, it, expect } from "vitest";
import {
  isPlacedInPane,
  layoutCommentRail,
  RAIL_CARD_MAX_HEIGHT,
  type RailItem,
} from "./commentRailLayout";

// Pane sits with its own top at viewport y=100 and is 600px tall, so anchors
// at 100..700 (viewport-absolute) are the ones actually inside the pane.
const VIEWPORT = { paneTop: 100 };
const PANE_HEIGHT = 600;

function item(
  id: string,
  anchorTop: number | null,
  height: number,
  order: number
): RailItem {
  return { id, anchorTop, height, order };
}

function topOf(result: ReturnType<typeof layoutCommentRail>, id: string): number {
  const placed = result.placed.find((p) => p.id === id);
  if (!placed) throw new Error(`${id} not placed`);
  return placed.top;
}

describe("layoutCommentRail", () => {
  it("1. orders cards by document order (order), not input order", () => {
    const items = [item("c", 500, 40, 2), item("a", 200, 40, 0), item("b", 350, 40, 1)];
    const result = layoutCommentRail(items, VIEWPORT);
    expect(result.placed.map((v) => v.id)).toEqual(["a", "b", "c"]);
  });

  it("2. overlapping cards are pushed down to previous top + height + gap", () => {
    // a: anchor 150 → top 50 (150-100), height 40 → occupies 50..90.
    // b: anchor 160 (relative 60) overlaps a's box (50..90) → pushed to
    //    90 + 8 = 98.
    const items = [item("a", 150, 40, 0), item("b", 160, 40, 1)];
    const result = layoutCommentRail(items, VIEWPORT);
    expect(topOf(result, "a")).toBe(50);
    expect(topOf(result, "b")).toBe(50 + 40 + 8);
  });

  it("3. a card whose anchor is above the pane keeps its own (negative) top instead of clamping to 0 (#338)", () => {
    // The old clamp parked a scrolled-past card at the pane's top edge, in
    // front of whatever paragraph was actually on screen.
    const items = [item("a", 80, 40, 0), item("b", 300, 40, 1)];
    const result = layoutCommentRail(items, VIEWPORT);
    expect(topOf(result, "a")).toBe(-20);
    expect(topOf(result, "b")).toBe(200);
  });

  it("4. a card that runs past the pane's bottom is still placed, not counted away (#338)", () => {
    // The case that used to become 下に 1 件: the anchor is on screen, the
    // card just doesn't end before the pane does.
    const items = [item("a", 650, 114, 0)];
    const result = layoutCommentRail(items, VIEWPORT);
    expect(result.placed).toEqual([{ id: "a", top: 550, maxHeight: 114 }]);
    expect(result.bottom).toBe(664);
  });

  it("5. stacking is the same at every scroll position: shifting every anchor by d shifts every top by d (#338)", () => {
    const anchors = [
      ["a", 120, 90],
      ["b", 150, 60],
      ["c", 160, 200],
      ["d", 900, 40],
    ] as const;
    const at = (d: number) =>
      layoutCommentRail(
        anchors.map(([id, top, h], i) => item(id, top + d, h, i)),
        VIEWPORT
      );
    const base = at(0);
    for (const d of [-700, -250, 0, 333]) {
      const shifted = at(d);
      expect(shifted.placed.map((p) => p.top - d)).toEqual(base.placed.map((p) => p.top));
      expect((shifted.bottom as number) - d).toBe(base.bottom);
    }
  });

  it("6. cards with anchorTop null are excluded and never placed", () => {
    const items = [item("a", 100, 40, 0), item("orphan", null, 40, 1)];
    const result = layoutCommentRail(items, VIEWPORT);
    expect(result.placed.map((v) => v.id)).toEqual(["a"]);
    expect(result.excluded).toEqual(["orphan"]);
  });

  it("7. empty input returns an empty layout without throwing", () => {
    expect(layoutCommentRail([], VIEWPORT)).toEqual({
      placed: [],
      bottom: null,
      excluded: [],
    });
  });

  it("8. a card taller than the cap is allotted RAIL_CARD_MAX_HEIGHT, and the next one stacks below the cap", () => {
    const items = [item("a", 100, 900, 0), item("b", 110, 40, 1)];
    const result = layoutCommentRail(items, VIEWPORT);
    expect(result.placed[0]).toEqual({
      id: "a",
      top: 0,
      maxHeight: RAIL_CARD_MAX_HEIGHT,
    });
    expect(topOf(result, "b")).toBe(RAIL_CARD_MAX_HEIGHT + 8);
  });

  it("9. every card near the document's end is placed, however many share the last lines (#338)", () => {
    // Was: one card shown, the rest 下に N 件 with no scroll left to reach them.
    const items = [
      item("x1", 1010, 114, 0),
      item("x2", 1043, 114, 1),
      item("y1", 1043, 114, 2),
      item("y2", 1043, 114, 3),
    ];
    const result = layoutCommentRail(items, { paneTop: 70 });
    expect(result.placed.map((p) => p.id)).toEqual(["x1", "x2", "y1", "y2"]);
    expect(result.placed.map((p) => p.top)).toEqual([940, 1062, 1184, 1306]);
    expect(result.bottom).toBe(1306 + 114);
  });
});

describe("isPlacedInPane", () => {
  it("is true for a card overlapping the pane at all, false only when it sits fully outside", () => {
    expect(isPlacedInPane({ id: "a", top: -39, maxHeight: 40 }, PANE_HEIGHT)).toBe(true);
    expect(isPlacedInPane({ id: "a", top: -40, maxHeight: 40 }, PANE_HEIGHT)).toBe(false);
    expect(isPlacedInPane({ id: "a", top: 599, maxHeight: 40 }, PANE_HEIGHT)).toBe(true);
    expect(isPlacedInPane({ id: "a", top: 600, maxHeight: 40 }, PANE_HEIGHT)).toBe(false);
  });
});
