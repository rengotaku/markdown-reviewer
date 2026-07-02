import { describe, it, expect } from "vitest";
import { simpleHash, buildFixFilename } from "./hash";

describe("simpleHash", () => {
  it("is deterministic for the same input", () => {
    expect(simpleHash("hello")).toBe(simpleHash("hello"));
  });

  it("differs for different inputs", () => {
    expect(simpleHash("hello")).not.toBe(simpleHash("hello!"));
  });

  it("hashes the empty string to the djb2 seed", () => {
    expect(simpleHash("")).toBe((5381).toString(36));
  });
});

describe("buildFixFilename", () => {
  it("inserts _fix before the extension", () => {
    expect(buildFixFilename("foo.md")).toBe("foo_fix.md");
    expect(buildFixFilename("docs/note.txt")).toBe("docs/note_fix.txt");
  });

  it("appends _fix when there is no extension", () => {
    expect(buildFixFilename("foo")).toBe("foo_fix");
  });

  it("treats a leading dot as no extension", () => {
    expect(buildFixFilename(".gitignore")).toBe(".gitignore_fix");
  });
});
