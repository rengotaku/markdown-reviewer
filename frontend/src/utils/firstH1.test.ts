import { describe, it, expect } from "vitest";
import { firstH1 } from "./firstH1";

describe("firstH1 (#247)", () => {
  it("returns the h1 text", () => {
    expect(firstH1("# 雑談ルーム\n\nbody")).toBe("雑談ルーム");
  });

  it("keeps the first h1 when the document has several", () => {
    expect(firstH1("# first\n\ntext\n\n# second\n")).toBe("first");
  });

  it("returns null when there is no h1", () => {
    expect(firstH1("## only an h2\n\nbody")).toBeNull();
    expect(firstH1("just a paragraph")).toBeNull();
  });

  it("ignores h1-looking lines inside fenced code blocks", () => {
    expect(firstH1("```sh\n# not a heading\n```\n\n# real heading\n")).toBe(
      "real heading"
    );
    expect(firstH1("~~~\n# not a heading\n~~~\n")).toBeNull();
  });

  it("skips the AI hint and frontmatter above the body", () => {
    const raw =
      "<!-- markdown-reviewer: read with `mr review` -->\n" +
      "---\n# a yaml comment, not a heading\ntitle: x\n---\n" +
      "# actual heading\n";
    expect(firstH1(raw)).toBe("actual heading");
  });

  it("reads a setext h1", () => {
    expect(firstH1("Underlined title\n===\n\nbody")).toBe("Underlined title");
    // A `===` run under a list item or a blank line is not a heading.
    expect(firstH1("- item\n===\n")).toBeNull();
    expect(firstH1("\n===\n")).toBeNull();
  });

  it("renders the heading as plain text", () => {
    expect(firstH1("# **bold** and `code` and [link](http://x)")).toBe(
      "bold and code and link"
    );
  });

  it("ignores an empty heading", () => {
    expect(firstH1("#\n\n# real\n")).toBe("real");
    expect(firstH1("# ##\n\n# real\n")).toBe("real");
  });

  it("does not treat h2+ as h1", () => {
    expect(firstH1("## two\n\n# one\n")).toBe("one");
  });
});

describe("firstH1 CommonMark edge cases (codex review on #247)", () => {
  it("keeps a trailing # that is part of the text", () => {
    expect(firstH1("# C#")).toBe("C#");
    expect(firstH1("# heading ###")).toBe("heading");
  });

  it("renders reference-style links as their text", () => {
    expect(firstH1("# [API][docs]")).toBe("API");
  });

  it("does not close a fence on a line carrying an info string", () => {
    expect(firstH1("```\n```js\n# inside the block\n```\n")).toBeNull();
  });

  it("does not read indented code as a setext heading", () => {
    expect(firstH1("    indented code\n===\n\n# real\n")).toBe("real");
  });
});
