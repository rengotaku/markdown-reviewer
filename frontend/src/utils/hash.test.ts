import { describe, it, expect } from "vitest";
import { buildFixFilename } from "./hash";

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
