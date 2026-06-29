import { describe, it, expect } from "vitest";
import {
  resolveAnchorInBlocks,
  computeAnchorInBlocks,
  computeAnchorAtBlock,
  blockIndexAtPos,
  type AnchorBlock,
} from "./pmAnchor";

// A small flattened document mirroring the markdown:
//   # 認証
//   ## トークンの期限
//   - アクセストークン: 24 時間
//   ## エラー
//   24 時間 という別の出現
// Positions are illustrative but internally consistent (start..end per block).
const blocks: AnchorBlock[] = [
  { start: 1, end: 5, text: "認証", headingStack: ["# 認証"] },
  {
    start: 7,
    end: 18,
    text: "トークンの期限",
    headingStack: ["# 認証", "## トークンの期限"],
  },
  {
    start: 20,
    end: 40,
    text: "アクセストークン: 24 時間",
    headingStack: ["# 認証", "## トークンの期限"],
  },
  { start: 42, end: 48, text: "エラー", headingStack: ["# 認証", "## エラー"] },
  {
    start: 50,
    end: 70,
    text: "24 時間 という別の出現",
    headingStack: ["# 認証", "## エラー"],
  },
];

describe("pmAnchor", () => {
  it("resolves a heading-scoped snippet to its first match range", () => {
    const r = resolveAnchorInBlocks(blocks, {
      heading_path: ["## トークンの期限"],
      snippet: "24 時間",
      occurrence: 0,
    });
    // block index 2 (start=20); offset = snippet position within the block text.
    const off = "アクセストークン: 24 時間".indexOf("24 時間");
    expect(r).toEqual({ from: 20 + off, to: 20 + off + "24 時間".length });
  });

  it("scopes the same snippet to a different heading", () => {
    const r = resolveAnchorInBlocks(blocks, {
      heading_path: ["## エラー"],
      snippet: "24 時間",
      occurrence: 0,
    });
    expect(r).toEqual({ from: 50, to: 50 + "24 時間".length });
  });

  it("returns null for an orphaned snippet", () => {
    expect(
      resolveAnchorInBlocks(blocks, { heading_path: [], snippet: "無い", occurrence: 0 })
    ).toBeNull();
  });

  it("computeAnchorInBlocks is the inverse of resolveAnchorInBlocks", () => {
    const a = computeAnchorInBlocks(blocks, 4, "24 時間");
    expect(a.heading_path).toEqual(["# 認証", "## エラー"]);
    expect(a.occurrence).toBe(0); // first under ## エラー
    expect(resolveAnchorInBlocks(blocks, a)).toEqual({
      from: 50,
      to: 50 + "24 時間".length,
    });
  });

  it("counts occurrence among duplicates under the same heading", () => {
    const dup: AnchorBlock[] = [
      { start: 1, end: 5, text: "H", headingStack: ["## H"] },
      { start: 7, end: 10, text: "x y", headingStack: ["## H"] },
      { start: 12, end: 15, text: "x z", headingStack: ["## H"] },
    ];
    const a = computeAnchorInBlocks(dup, 2, "x");
    expect(a.occurrence).toBe(1);
    expect(resolveAnchorInBlocks(dup, a)).toEqual({ from: 12, to: 13 });
  });

  it("computeAnchorAtBlock anchors a whole heading block", () => {
    const a = computeAnchorAtBlock(blocks, 3);
    expect(a).not.toBeNull();
    expect(a!.snippet).toBe("エラー");
    expect(a!.heading_path).toEqual(["# 認証", "## エラー"]);
    expect(resolveAnchorInBlocks(blocks, a!)).toEqual({ from: 42, to: 45 });
  });

  it("blockIndexAtPos locates the block holding a position", () => {
    expect(blockIndexAtPos(blocks, 25)).toBe(2);
    expect(blockIndexAtPos(blocks, 60)).toBe(4);
    expect(blockIndexAtPos(blocks, 999)).toBe(-1);
  });
});
