import { describe, it, expect } from "vitest";
import {
  topLevelBlockRanges,
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
    expect(ranges[0]).toEqual({ start: 0, end: 1 });
    expect(ranges[1]).toEqual({ start: 2, end: 4 });
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
    });
  });
});
