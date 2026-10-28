import { describe, it, expect } from "vitest";
import {
  topLevelBlockRanges,
  gutterUnitRanges,
  computeDiffGutterMarks,
} from "./diffGutterMarks";
import { splitPreamble } from "@/utils/frontmatter";

describe("topLevelBlockRanges", () => {
  it("returns one range per top-level block, excluding nested content", () => {
    const body = [
      "# Heading",
      "",
      "Some paragraph",
      "text here.",
      "",
      "- item1",
      "- item2",
      "",
      "```js",
      "code here",
      "```",
      "",
    ].join("\n");
    const ranges = topLevelBlockRanges(body);
    // heading, paragraph, list, fence — four top-level blocks, not one per
    // list item / paragraph line.
    expect(ranges).toHaveLength(4);
    expect(ranges[0]).toEqual({ type: "heading_open", start: 0, end: 1 });
    expect(ranges[1]).toEqual({ type: "paragraph_open", start: 2, end: 4 });
    expect(ranges.map((r) => r.type)).toEqual([
      "heading_open",
      "paragraph_open",
      "bullet_list_open",
      "fence",
    ]);
  });

  it("returns an empty array for an empty body", () => {
    expect(topLevelBlockRanges("")).toEqual([]);
  });
});

describe("computeDiffGutterMarks", () => {
  it("reports no marks and the block count when nothing changed", () => {
    const body = "# Title\n\nSame paragraph.\n";
    const result = computeDiffGutterMarks(body, body);
    expect(result.marks).toEqual([]);
    expect(result.blockCount).toBe(2);
  });

  it("marks a wholly new block as add", () => {
    const baseline = "# Title\n\nFirst paragraph.\n";
    const current = "# Title\n\nFirst paragraph.\n\nSecond paragraph.\n";
    const result = computeDiffGutterMarks(baseline, current);
    expect(result.blockCount).toBe(3);
    expect(result.marks).toEqual([{ blockIndex: 2, kind: "add" }]);
  });

  it("marks a partially edited block as mod", () => {
    const baseline = "# Title\n\nLine one.\nLine two.\n";
    const current = "# Title\n\nLine one.\nLine two changed.\n";
    const result = computeDiffGutterMarks(baseline, current);
    // The paragraph (block 1) spans both lines; only one of its two lines
    // changed, so it's "mod" rather than "add".
    expect(result.marks).toEqual([{ blockIndex: 1, kind: "mod" }]);
  });

  it("marks the block that now sits where deleted content used to be", () => {
    const baseline = "# Title\n\nDoomed paragraph.\n\nSurvivor paragraph.\n";
    const current = "# Title\n\nSurvivor paragraph.\n";
    const result = computeDiffGutterMarks(baseline, current);
    expect(result.blockCount).toBe(2);
    // "Survivor paragraph." (block 1) is unchanged itself, but a deletion
    // happened directly above it.
    expect(result.marks).toEqual([{ blockIndex: 1, delAbove: true }]);
  });

  it("attributes a trailing deletion to the last block", () => {
    const baseline = "# Title\n\nKeep me.\n\nDelete me.\n";
    const current = "# Title\n\nKeep me.\n";
    const result = computeDiffGutterMarks(baseline, current);
    expect(result.blockCount).toBe(2);
    expect(result.marks).toEqual([{ blockIndex: 1, delAbove: true }]);
  });

  it("combines add/mod with delAbove on the same block", () => {
    const baseline = "# Title\n\nDoomed.\n\nOld line.\n";
    const current = "# Title\n\nNew line.\n";
    const result = computeDiffGutterMarks(baseline, current);
    expect(result.blockCount).toBe(2);
    expect(result.marks).toEqual([{ blockIndex: 1, kind: "mod", delAbove: true }]);
  });

  it("returns no marks and blockCount 0 for an empty current body", () => {
    const result = computeDiffGutterMarks("# Title\n", "");
    expect(result.marks).toEqual([]);
    expect(result.blockCount).toBe(0);
  });

  it("does not shift line numbers when frontmatter/hint is stripped first", () => {
    const raw = [
      "<!-- markdown-reviewer",
      "hint block",
      "-->",
      "---",
      "title: doc",
      "---",
      "# Heading",
      "",
      "Body paragraph.",
      "",
    ].join("\n");
    const { body: baselineBody } = splitPreamble(raw);
    const editedRaw = raw.replace("Body paragraph.", "Body paragraph edited.");
    const { body: currentBody } = splitPreamble(editedRaw);

    const result = computeDiffGutterMarks(baselineBody, currentBody);
    expect(result.blockCount).toBe(2);
    // "Body paragraph edited." is the second top-level block (index 1) once
    // the preamble has been peeled off both sides consistently.
    expect(result.marks).toEqual([{ blockIndex: 1, kind: "mod" }]);
  });

  it("degrades gracefully when block boundaries are ambiguous (no crash)", () => {
    const baseline = "";
    const current = "";
    expect(() => computeDiffGutterMarks(baseline, current)).not.toThrow();
    expect(computeDiffGutterMarks(baseline, current)).toEqual({
      marks: [],
      blockCount: 0,
      groupSizes: [],
    });
  });
});

describe("gutterUnitRanges (#368)", () => {
  it("splits lists into items, nested items right after their parent", () => {
    const body = ["# H", "", "- a", "  - a1", "- b", "", "after", ""].join("\n");
    expect(gutterUnitRanges(body)).toEqual([
      { type: "heading_open", start: 0, end: 1 },
      { type: "list_item_open", start: 2, end: 4 },
      { type: "list_item_open", start: 3, end: 4 },
      { type: "list_item_open", start: 4, end: 5 },
      { type: "paragraph_open", start: 6, end: 7 },
    ]);
  });

  it("splits tables into rows; the header row also covers the delimiter row", () => {
    const body = ["| x |", "|---|", "| 1 |", "| 2 |", ""].join("\n");
    expect(gutterUnitRanges(body)).toEqual([
      { type: "tr_open", start: 0, end: 2 },
      { type: "tr_open", start: 2, end: 3 },
      { type: "tr_open", start: 3, end: 4 },
    ]);
  });

  it("keeps a list inside a blockquote as part of the blockquote", () => {
    expect(gutterUnitRanges("> - a\n> - b\n")).toEqual([
      { type: "blockquote_open", start: 0, end: 2 },
    ]);
  });
});

describe("computeDiffGutterMarks — list items and table rows (#368)", () => {
  it("marks the edited item, not the first item of the list", () => {
    const before = "- a\n- b\n- c\n";
    const after = "- a\n- b\n- C\n";
    expect(computeDiffGutterMarks(before, after).marks).toEqual([
      { blockIndex: 2, kind: "mod" },
    ]);
  });

  it("marks each added item separately", () => {
    const before = "- a\n- c\n";
    const after = "- a\n- b\n- c\n- d\n";
    expect(computeDiffGutterMarks(before, after).marks).toEqual([
      { blockIndex: 1, kind: "add" },
      { blockIndex: 3, kind: "add" },
    ]);
  });

  it("marks a new nested item as add without touching its parent", () => {
    const before = "- a\n- b\n";
    const after = "- a\n  - a1\n- b\n";
    expect(computeDiffGutterMarks(before, after).marks).toEqual([
      { blockIndex: 1, kind: "add" },
    ]);
  });

  it("marks the edited table row", () => {
    const before = "| x |\n|---|\n| 1 |\n| 2 |\n";
    const after = "| x |\n|---|\n| 1 |\n| 3 |\n";
    expect(computeDiffGutterMarks(before, after).marks).toEqual([
      { blockIndex: 2, kind: "mod" },
    ]);
  });

  it("attributes a delimiter-row change to the header row", () => {
    const before = "| x |\n|---|\n| 1 |\n";
    const after = "| x |\n|:-:|\n| 1 |\n";
    expect(computeDiffGutterMarks(before, after).marks).toEqual([
      { blockIndex: 0, kind: "mod" },
    ]);
  });

  it("marks an item appended to a list followed by a blank line as add", () => {
    const before = "- a\n- b\n\nafter\n";
    const after = "- a\n- b\n- c\n\nafter\n";
    expect(computeDiffGutterMarks(before, after).marks).toEqual([
      { blockIndex: 2, kind: "add" },
    ]);
  });

  it("puts the dash for a deleted last item on the next block, not on the item above", () => {
    const before = "- a\n- b\n\nafter\n";
    const after = "- a\n\nafter\n";
    expect(computeDiffGutterMarks(before, after).marks).toEqual([
      { blockIndex: 1, delAbove: true },
    ]);
  });

  it("marks every rewritten item of a run as mod, with no dash", () => {
    const before = "- a\n- b\n  - b1\n";
    const after = "- A\n- B\n  - B1\n";
    expect(computeDiffGutterMarks(before, after).marks).toEqual([
      { blockIndex: 0, kind: "mod" },
      { blockIndex: 1, kind: "mod" },
      { blockIndex: 2, kind: "mod" },
    ]);
  });

  it("marks every rewritten table row of a run as mod, with no dash", () => {
    const before = "| x |\n|---|\n| 1 |\n| 2 |\n";
    const after = "| x |\n|---|\n| 3 |\n| 4 |\n";
    expect(computeDiffGutterMarks(before, after).marks).toEqual([
      { blockIndex: 1, kind: "mod" },
      { blockIndex: 2, kind: "mod" },
    ]);
  });

  it("splits a hunk into a rewritten item and a new one", () => {
    const before = "- a\n";
    const after = "- A\n- b\n";
    expect(computeDiffGutterMarks(before, after).marks).toEqual([
      { blockIndex: 0, kind: "mod" },
      { blockIndex: 1, kind: "add" },
    ]);
  });

  it("puts a deleted item's dash on the item that follows it", () => {
    const before = "- a\n- b\n- c\n";
    const after = "- a\n- c\n";
    expect(computeDiffGutterMarks(before, after).marks).toEqual([
      { blockIndex: 1, delAbove: true },
    ]);
  });
});
