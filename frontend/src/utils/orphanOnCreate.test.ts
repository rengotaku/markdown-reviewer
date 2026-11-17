import { describe, it, expect } from "vitest";
import { orphanOnCreateWarning, ORPHAN_ON_CREATE_MESSAGE } from "./orphanOnCreate";

describe("orphanOnCreateWarning (#404)", () => {
  it("warns when a comment on a saved file comes back orphaned", () => {
    expect(orphanOnCreateWarning({ orphan: true }, false, true)).toBe(ORPHAN_ON_CREATE_MESSAGE);
  });

  it("warns when the server resolved it but its anchor does not resolve in the editor", () => {
    expect(orphanOnCreateWarning({ orphan: false }, false, false)).toBe(ORPHAN_ON_CREATE_MESSAGE);
  });

  it("stays quiet while there are unsaved edits (the anchor heals on save)", () => {
    expect(orphanOnCreateWarning({ orphan: true }, true, false)).toBeNull();
  });

  it("stays quiet when the comment landed on both sides", () => {
    expect(orphanOnCreateWarning({ orphan: false }, false, true)).toBeNull();
    expect(orphanOnCreateWarning({}, false, true)).toBeNull();
    expect(orphanOnCreateWarning(null, false, false)).toBeNull();
  });
});
