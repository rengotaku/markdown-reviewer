import { describe, it, expect } from "vitest";
import {
  headingStacks,
  resolveAnchorLine,
  computeAnchorAtLine,
} from "./commentAnchor";

const body = [
  "# 認証", // 0
  "", // 1
  "## トークンの期限", // 2
  "", // 3
  "- アクセストークン: 24 時間", // 4
  "- リフレッシュトークン: なし", // 5
  "", // 6
  "## エラー", // 7
  "", // 8
  "24 時間 という別の出現", // 9
].join("\n");

describe("commentAnchor", () => {
  it("tracks the heading stack per line", () => {
    expect(headingStacks(body)[4]).toEqual(["# 認証", "## トークンの期限"]);
    expect(headingStacks(body)[9]).toEqual(["# 認証", "## エラー"]);
  });

  it("resolves a heading-scoped snippet to its line", () => {
    expect(
      resolveAnchorLine(body, {
        heading_path: ["## トークンの期限"],
        snippet: "24 時間",
        occurrence: 0,
      })
    ).toBe(4);
    expect(
      resolveAnchorLine(body, {
        heading_path: ["## エラー"],
        snippet: "24 時間",
        occurrence: 0,
      })
    ).toBe(9);
  });

  it("returns null for an orphaned snippet", () => {
    expect(
      resolveAnchorLine(body, { heading_path: [], snippet: "無い", occurrence: 0 })
    ).toBeNull();
  });

  it("computeAnchorAtLine is the inverse of resolveAnchorLine", () => {
    const a = computeAnchorAtLine(body, "24 時間", 9);
    expect(a.heading_path).toEqual(["# 認証", "## エラー"]);
    expect(a.occurrence).toBe(0); // first under その heading
    expect(resolveAnchorLine(body, a)).toBe(9);
  });

  it("counts occurrence among duplicates under the same heading", () => {
    const dup = ["## H", "x", "x", "x"].join("\n");
    const a = computeAnchorAtLine(dup, "x", 3); // third x (line index 3)
    expect(a.occurrence).toBe(2);
    expect(resolveAnchorLine(dup, a)).toBe(3);
  });
});
