import { describe, it, expect } from "vitest";
import { computeBlankLines } from "./blankLines";

describe("computeBlankLines", () => {
  it("reports zero extras when blocks are separated by a single blank line", () => {
    const body = "# Title\n\nParagraph one.\n\nParagraph two.\n";
    expect(computeBlankLines(body)).toEqual({
      extras: [0, 0, 0],
      blockCount: 3,
    });
  });

  it("reports extras for a 2-blank-line gap", () => {
    const body = "Paragraph one.\n\n\nParagraph two.\n";
    expect(computeBlankLines(body)).toEqual({
      extras: [0, 1],
      blockCount: 2,
    });
  });

  it("reports extras for a 5-blank-line gap", () => {
    // 5 blank lines between the two paragraphs: 1 is the normal separator,
    // 4 are "extra".
    const body = "Paragraph one.\n\n\n\n\n\nParagraph two.\n";
    expect(computeBlankLines(body)).toEqual({
      extras: [0, 4],
      blockCount: 2,
    });
  });

  it("counts leading blank lines before the first block", () => {
    const body = "\n\n\n# Title\n\nBody.\n";
    expect(computeBlankLines(body)).toEqual({
      extras: [3, 0],
      blockCount: 2,
    });
  });

  it("does not count blank lines inside a list", () => {
    const body = "- item1\n\n- item2\n\nAfter list.\n";
    // The blank line between the two list items is inside the (loose) list
    // block, not between top-level blocks.
    const result = computeBlankLines(body);
    expect(result.blockCount).toBe(2);
    expect(result.extras).toEqual([0, 0]);
  });

  it("does not count blank lines inside a fenced code block", () => {
    const body = ["```js", "foo();", "", "", "", "bar();", "```", ""].join(
      "\n"
    );
    expect(computeBlankLines(body)).toEqual({
      extras: [0],
      blockCount: 1,
    });
  });

  it("counts blank lines before and after a fenced code block", () => {
    const body = [
      "Intro.",
      "",
      "",
      "```js",
      "code();",
      "```",
      "",
      "",
      "",
      "Outro.",
      "",
    ].join("\n");
    expect(computeBlankLines(body)).toEqual({
      extras: [0, 1, 2],
      blockCount: 3,
    });
  });

  it("counts blank lines before and after a table", () => {
    const body = [
      "Intro.",
      "",
      "",
      "| a | b |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "",
      "Outro.",
      "",
    ].join("\n");
    expect(computeBlankLines(body)).toEqual({
      extras: [0, 1, 1],
      blockCount: 3,
    });
  });

  it("returns an empty payload for an empty body", () => {
    expect(computeBlankLines("")).toEqual({ extras: [], blockCount: 0 });
  });

  it("returns an empty payload for a body of only blank lines", () => {
    expect(computeBlankLines("\n\n\n")).toEqual({ extras: [], blockCount: 0 });
  });
});
