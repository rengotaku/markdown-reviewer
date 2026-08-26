import { describe, it, expect } from "vitest";
import { computeLineNumbers, preambleLineOffset } from "./lineNumbers";

describe("preambleLineOffset (#234)", () => {
  it("counts the lines the body is preceded by", () => {
    const body = "# Title\n\nhello\n";
    const raw = `---\ntitle: x\n---\n${body}`;
    expect(preambleLineOffset(raw, body)).toBe(3);
  });

  it("is 0 when there is no preamble", () => {
    const body = "# Title\n";
    expect(preambleLineOffset(body, body)).toBe(0);
  });

  it("is 0 when body is not a suffix of raw (rather than guessing)", () => {
    expect(preambleLineOffset("---\na\n---\n# A\n", "# B\n")).toBe(0);
  });
});

describe("computeLineNumbers (#234)", () => {
  it("numbers each top-level block by its first source line", () => {
    const body = "# Title\n\nfirst paragraph\n\n- a\n- b\n\nlast\n";
    expect(computeLineNumbers(body, body)).toEqual({
      lines: [1, 3, 5, 8],
      blockCount: 4,
    });
  });

  it("adds the preamble back so numbers match the file on disk", () => {
    const body = "# Title\n\nfirst paragraph\n";
    const raw = `---\ntitle: x\n---\n${body}`;
    expect(computeLineNumbers(raw, body)).toEqual({
      lines: [4, 6],
      blockCount: 2,
    });
  });

  it("returns an empty payload for an empty body", () => {
    expect(computeLineNumbers("", "")).toEqual({ lines: [], blockCount: 0 });
  });
});
