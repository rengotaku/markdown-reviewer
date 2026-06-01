import { describe, it, expect } from "vitest";
import {
  computeCrossSectionRanges,
  type NodeProbe,
} from "./crossSectionRanges";

function makeProbe(byPos: Record<number, NodeProbe>): (pos: number) => NodeProbe | null {
  return (pos) => byPos[pos] ?? null;
}

function counterId(): () => string {
  let i = 0;
  return () => `r-${++i}`;
}

describe("computeCrossSectionRanges", () => {
  it("returns one range per heading using [pos+1, pos+nodeSize-1] as inner text bounds", () => {
    const ranges = computeCrossSectionRanges(
      [{ pos: 10 }, { pos: 40 }],
      makeProbe({
        10: { name: "heading", nodeSize: 6 }, // text range = [11, 15]
        40: { name: "heading", nodeSize: 10 }, // text range = [41, 49]
      }),
      counterId()
    );
    expect(ranges).toEqual([
      { from: 11, to: 15, id: "r-1" },
      { from: 41, to: 49, id: "r-2" },
    ]);
  });

  it("skips entries whose probe yields null (heading deleted between dialog open and submit)", () => {
    const ranges = computeCrossSectionRanges(
      [{ pos: 0 }, { pos: 10 }],
      makeProbe({
        10: { name: "heading", nodeSize: 5 },
      }),
      counterId()
    );
    expect(ranges).toEqual([{ from: 11, to: 14, id: "r-1" }]);
  });

  it("skips entries whose probe yields a non-heading node (doc shape changed)", () => {
    const ranges = computeCrossSectionRanges(
      [{ pos: 0 }, { pos: 10 }],
      makeProbe({
        0: { name: "paragraph", nodeSize: 4 },
        10: { name: "heading", nodeSize: 5 },
      }),
      counterId()
    );
    expect(ranges).toEqual([{ from: 11, to: 14, id: "r-1" }]);
  });

  it("skips zero-width ranges (empty heading text)", () => {
    // An empty heading is just open + close tokens — nodeSize = 2, inner range
    // would be [pos+1, pos+1] which is degenerate.
    const ranges = computeCrossSectionRanges(
      [{ pos: 5 }],
      makeProbe({ 5: { name: "heading", nodeSize: 2 } }),
      counterId()
    );
    expect(ranges).toEqual([]);
  });

  it("returns an empty array when nothing is selected", () => {
    const ranges = computeCrossSectionRanges([], makeProbe({}), counterId());
    expect(ranges).toEqual([]);
  });

  it("mints a fresh id per surviving range (callers use these as marker ids)", () => {
    const ranges = computeCrossSectionRanges(
      [{ pos: 0 }, { pos: 10 }, { pos: 20 }],
      makeProbe({
        0: { name: "heading", nodeSize: 5 },
        10: { name: "heading", nodeSize: 5 },
        20: { name: "heading", nodeSize: 5 },
      }),
      counterId()
    );
    expect(ranges.map((r) => r.id)).toEqual(["r-1", "r-2", "r-3"]);
  });
});
