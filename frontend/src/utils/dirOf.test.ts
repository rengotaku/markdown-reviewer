import { describe, it, expect } from "vitest";
import { dirOf } from "./dirOf";

describe("dirOf", () => {
  it("returns the directory of a nested path", () => {
    expect(dirOf("a/b/c.md")).toBe("a/b");
  });

  it("returns empty string for a root-level file", () => {
    expect(dirOf("c.md")).toBe("");
  });

  it("returns empty string for an empty path", () => {
    expect(dirOf("")).toBe("");
  });

  it("treats all root-level files as the same directory", () => {
    expect(dirOf("a.md")).toBe(dirOf("b.md"));
  });

  it("distinguishes different directories", () => {
    expect(dirOf("docs/a.md")).not.toBe(dirOf("src/a.md"));
  });
});
