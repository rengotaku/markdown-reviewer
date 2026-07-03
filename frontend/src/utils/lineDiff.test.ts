import { describe, it, expect } from "vitest";
import { lineDiff, hasChanges, charDiff, intraLineSegments } from "./lineDiff";

describe("lineDiff", () => {
  it("marks identical text as all-equal with no changes", () => {
    const rows = lineDiff("a\nb\nc\n", "a\nb\nc\n");
    expect(rows.map((r) => r.type)).toEqual(["equal", "equal", "equal"]);
    expect(hasChanges(rows)).toBe(false);
  });

  it("detects a single changed line as del+add", () => {
    const rows = lineDiff("a\nb\nc", "a\nB\nc");
    expect(rows).toEqual([
      { type: "equal", text: "a", oldLine: 1, newLine: 1 },
      { type: "del", text: "b", oldLine: 2, newLine: null },
      { type: "add", text: "B", oldLine: null, newLine: 2 },
      { type: "equal", text: "c", oldLine: 3, newLine: 3 },
    ]);
    expect(hasChanges(rows)).toBe(true);
  });

  it("detects an inserted line", () => {
    const rows = lineDiff("a\nc", "a\nb\nc");
    expect(rows.map((r) => `${r.type}:${r.text}`)).toEqual([
      "equal:a",
      "add:b",
      "equal:c",
    ]);
  });

  it("detects a deleted line", () => {
    const rows = lineDiff("a\nb\nc", "a\nc");
    expect(rows.map((r) => `${r.type}:${r.text}`)).toEqual([
      "equal:a",
      "del:b",
      "equal:c",
    ]);
  });

  it("ignores a single trailing newline difference", () => {
    const rows = lineDiff("a\nb", "a\nb\n");
    expect(hasChanges(rows)).toBe(false);
  });

  it("handles full replacement", () => {
    const rows = lineDiff("x\ny", "a\nb");
    expect(rows.map((r) => r.type)).toEqual(["del", "del", "add", "add"]);
  });
});

describe("charDiff", () => {
  const text = (segs: { text: string; changed: boolean }[]) =>
    segs.map((s) => s.text).join("");
  const changedText = (segs: { text: string; changed: boolean }[]) =>
    segs
      .filter((s) => s.changed)
      .map((s) => s.text)
      .join("");

  it("marks only the differing characters within a line", () => {
    // shared "abc" prefix + "def" suffix; the middle shares no characters
    const { del, add, ratio } = charDiff("abcXYZdef", "abcPQRdef");
    // segments must reconstruct each side losslessly
    expect(text(del)).toBe("abcXYZdef");
    expect(text(add)).toBe("abcPQRdef");
    // only the middle run is flagged changed
    expect(changedText(del)).toBe("XYZ");
    expect(changedText(add)).toBe("PQR");
    expect(ratio).toBeGreaterThan(0.3);
  });

  it("flags everything changed for fully dissimilar lines (ratio 0)", () => {
    const { del, add, ratio } = charDiff("abc", "xyz");
    expect(changedText(del)).toBe("abc");
    expect(changedText(add)).toBe("xyz");
    expect(ratio).toBe(0);
  });

  it("handles Japanese edits", () => {
    const { del, add } = charDiff("変更前のテキスト", "変更後のテキスト");
    expect(changedText(del)).toBe("前");
    expect(changedText(add)).toBe("後");
  });
});

describe("intraLineSegments", () => {
  it("annotates a similar del/add pair but leaves equal rows alone", () => {
    const rows = lineDiff("a\nthe brown fox\nc", "a\nthe red fox\nc");
    // rows: equal(a), del(brown), add(red), equal(c)
    const map = intraLineSegments(rows);
    expect(map.has(0)).toBe(false); // equal
    expect(map.has(1)).toBe(true); // del
    expect(map.has(2)).toBe(true); // add
    expect(map.has(3)).toBe(false); // equal
  });

  it("skips intra-line highlighting for dissimilar del/add pairs", () => {
    const rows = lineDiff("abc", "xyz");
    const map = intraLineSegments(rows);
    expect(map.size).toBe(0);
  });

  it("leaves pure insertions unannotated", () => {
    const rows = lineDiff("a\nc", "a\nb\nc");
    const map = intraLineSegments(rows);
    expect(map.size).toBe(0);
  });
});
