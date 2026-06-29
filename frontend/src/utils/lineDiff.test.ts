import { describe, it, expect } from "vitest";
import { lineDiff, hasChanges } from "./lineDiff";

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
