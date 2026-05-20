import { describe, it, expect } from "vitest";
import {
  buildCommentAttrs,
  escapeCommentAttr,
  parseCommentAttrs,
  unescapeCommentAttr,
} from "./commentAttrs";

describe("commentAttrs escape/unescape", () => {
  it.each([
    ["plain text", "plain text"],
    ['has "quotes"', 'has \\"quotes\\"'],
    ["back\\slash", "back\\\\slash"],
    ["line\nbreak", "line\\nbreak"],
    ["double--dashes", "double\\-\\-dashes"],
    ["", ""],
  ])("escape(%j) -> %j", (input, expected) => {
    expect(escapeCommentAttr(input)).toBe(expected);
  });

  it.each([
    "plain text",
    'has "quotes"',
    "back\\slash",
    "line\nbreak",
    "double--dashes",
    'mixed "back\\slash" and -- dash',
  ])("round-trip unescape(escape(%j))", (input) => {
    expect(unescapeCommentAttr(escapeCommentAttr(input))).toBe(input);
  });
});

describe("parseCommentAttrs / buildCommentAttrs", () => {
  it("parses a typical attribute string", () => {
    const s = 'id="c1" author="kishira" date="2026-05-20" target="この段落"';
    expect(parseCommentAttrs(s)).toEqual({
      id: "c1",
      author: "kishira",
      date: "2026-05-20",
      target: "この段落",
    });
  });

  it("handles escaped quotes inside target", () => {
    const s = 'id="c1" target="say \\"hi\\""';
    const parsed = parseCommentAttrs(s);
    expect(parsed.target).toBe('say "hi"');
  });

  it("round-trips through buildCommentAttrs", () => {
    const attrs = {
      id: "01J8FOO",
      author: "kishira",
      date: "2026-05-20",
      target: 'tricky -- "value"',
    };
    const built = buildCommentAttrs(attrs);
    expect(parseCommentAttrs(built)).toEqual(attrs);
  });

  it("ignores unknown / missing keys gracefully", () => {
    expect(parseCommentAttrs("id=\"only\"")).toEqual({ id: "only" });
    expect(parseCommentAttrs("")).toEqual({});
  });
});
