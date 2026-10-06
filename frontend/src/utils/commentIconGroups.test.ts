import { describe, it, expect } from "vitest";
import { groupIconRailEntries } from "./commentIconGroups";

describe("groupIconRailEntries (#332)", () => {
  it("merges consecutive comments anchored on the same line into one icon", () => {
    const entries = groupIconRailEntries(["a", "b", "c"], { a: 100, b: 100, c: 300 }, null);
    expect(entries).toEqual([
      { kind: "icon", key: "icon:a", ids: ["a", "b"] },
      { kind: "icon", key: "icon:c", ids: ["c"] },
    ]);
  });

  it("does not merge same-height comments that aren't consecutive in document order", () => {
    const entries = groupIconRailEntries(["a", "b", "c"], { a: 100, b: 300, c: 100 }, null);
    expect(entries.map((e) => e.ids)).toEqual([["a"], ["b"], ["c"]]);
  });

  it("pulls the selected comment out of its line's icon as its own card, splitting the run", () => {
    const entries = groupIconRailEntries(
      ["a", "b", "c"],
      { a: 100, b: 100, c: 100 },
      "b"
    );
    expect(entries).toEqual([
      { kind: "icon", key: "icon:a", ids: ["a"] },
      { kind: "card", key: "b", ids: ["b"] },
      { kind: "icon", key: "icon:c", ids: ["c"] },
    ]);
  });

  it("keeps a comment with no measured anchor on its own (never merged into a neighbour)", () => {
    const entries = groupIconRailEntries(["a", "b", "c"], { a: 100, c: 100 }, null);
    expect(entries.map((e) => e.ids)).toEqual([["a"], ["b"], ["c"]]);
  });
});
