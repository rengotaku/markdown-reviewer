import { describe, it, expect } from "vitest";
import {
  buildCommentAttrs,
  buildStandaloneCommentAttrs,
  escapeCommentAttr,
  isStandaloneScope,
  normalizeScope,
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
    const s =
      'id="c1" author="kishira" date="2026-05-20" target="この段落" body="直して"';
    expect(parseCommentAttrs(s)).toEqual({
      id: "c1",
      author: "kishira",
      date: "2026-05-20",
      target: "この段落",
      body: "直して",
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
      body: 'multi\nline -- with "quotes"',
    };
    const built = buildCommentAttrs(attrs);
    expect(parseCommentAttrs(built)).toEqual(attrs);
  });

  it("ignores unknown / missing keys gracefully", () => {
    expect(parseCommentAttrs("id=\"only\"")).toEqual({ id: "only" });
    expect(parseCommentAttrs("")).toEqual({});
  });
});

describe("scope helpers", () => {
  it("normalizes recognised scope strings, falls back to inline otherwise", () => {
    expect(normalizeScope("inline")).toBe("inline");
    expect(normalizeScope("block")).toBe("block");
    expect(normalizeScope("cross-section")).toBe("cross-section");
    expect(normalizeScope("global")).toBe("global");
    expect(normalizeScope("")).toBe("inline");
    expect(normalizeScope(null)).toBe("inline");
    expect(normalizeScope(undefined)).toBe("inline");
    expect(normalizeScope("bogus")).toBe("inline");
  });

  it("flags cross-section and global as standalone scopes", () => {
    expect(isStandaloneScope("inline")).toBe(false);
    expect(isStandaloneScope("block")).toBe(false);
    expect(isStandaloneScope("cross-section")).toBe(true);
    expect(isStandaloneScope("global")).toBe(true);
  });
});

describe("buildCommentAttrs scope emission", () => {
  const base = {
    id: "c1",
    author: "k",
    date: "2026-05-20",
    target: "x",
    body: "note",
  };

  it("omits scope attribute when scope is missing or default inline", () => {
    expect(buildCommentAttrs(base)).not.toContain("scope=");
    expect(buildCommentAttrs({ ...base, scope: "" })).not.toContain("scope=");
    expect(buildCommentAttrs({ ...base, scope: "inline" })).not.toContain(
      "scope="
    );
  });

  it("emits scope attribute when scope is non-default", () => {
    expect(buildCommentAttrs({ ...base, scope: "block" })).toContain(
      'scope="block"'
    );
    expect(buildCommentAttrs({ ...base, scope: "cross-section" })).toContain(
      'scope="cross-section"'
    );
    expect(buildCommentAttrs({ ...base, scope: "global" })).toContain(
      'scope="global"'
    );
  });
});

describe("buildStandaloneCommentAttrs", () => {
  it("omits target, always emits scope, and round-trips through parse", () => {
    const attrs = {
      id: "g1",
      author: "k",
      date: "2026-05-25",
      body: "ファイル全体への指摘",
      scope: "global",
    };
    const built = buildStandaloneCommentAttrs(attrs);
    expect(built).not.toContain("target=");
    expect(built).toContain('scope="global"');
    expect(parseCommentAttrs(built)).toEqual(attrs);
  });
});
