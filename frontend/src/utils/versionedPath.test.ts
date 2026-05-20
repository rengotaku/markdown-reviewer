import { describe, it, expect } from "vitest";
import { nextVersionedPath } from "./versionedPath";

describe("nextVersionedPath", () => {
  it("appends .v2 when there are no existing versions", () => {
    expect(nextVersionedPath("foo.md", ["foo.md"])).toBe("foo.v2.md");
  });

  it("picks the next free version when v2 already exists", () => {
    expect(
      nextVersionedPath("foo.md", ["foo.md", "foo.v2.md", "foo.v3.md"])
    ).toBe("foo.v4.md");
  });

  it("handles current path that already has a version suffix", () => {
    expect(
      nextVersionedPath("foo.v2.md", ["foo.md", "foo.v2.md"])
    ).toBe("foo.v3.md");
  });

  it("handles nested directories", () => {
    expect(
      nextVersionedPath("a/b/c.md", ["a/b/c.md", "a/b/c.v5.md", "a/b/other.md"])
    ).toBe("a/b/c.v6.md");
  });

  it("ignores files in other directories with matching name", () => {
    expect(
      nextVersionedPath("a/foo.md", ["a/foo.md", "b/foo.v5.md", "foo.v9.md"])
    ).toBe("a/foo.v2.md");
  });

  it("treats current version number as floor even when no sibling has it yet", () => {
    expect(nextVersionedPath("foo.v7.md", ["foo.md"])).toBe("foo.v8.md");
  });

  it("base names with dots are preserved", () => {
    expect(
      nextVersionedPath("docs/intro.md", ["docs/intro.md"])
    ).toBe("docs/intro.v2.md");
  });

  it("non-md path falls back to appending .v2.md", () => {
    expect(nextVersionedPath("notes.txt", [])).toBe("notes.txt.v2.md");
  });
});
