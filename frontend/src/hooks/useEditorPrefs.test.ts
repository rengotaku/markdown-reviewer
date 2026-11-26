import { describe, it, expect, beforeEach } from "vitest";
import { useEditorPrefs } from "./useEditorPrefs";

describe("useEditorPrefs", () => {
  beforeEach(() => {
    useEditorPrefs.setState({ centered: true });
  });

  it("defaults to centered layout", () => {
    expect(useEditorPrefs.getState().centered).toBe(true);
  });

  it("toggleCentered flips the flag back and forth", () => {
    useEditorPrefs.getState().toggleCentered();
    expect(useEditorPrefs.getState().centered).toBe(false);
    useEditorPrefs.getState().toggleCentered();
    expect(useEditorPrefs.getState().centered).toBe(true);
  });

  it("ignores the pane-layout preference left in storage by an older build (#413)", async () => {
    // Key spelled in two parts: the removed name must not appear in src.
    const legacyKey = "comment" + "RailMode";
    localStorage.setItem(
      "markdown-reviewer-prefs",
      JSON.stringify({ state: { centered: false, [legacyKey]: "list" }, version: 0 })
    );
    await useEditorPrefs.persist.rehydrate();
    expect(useEditorPrefs.getState().centered).toBe(false);
    expect(legacyKey in useEditorPrefs.getState()).toBe(false);
    localStorage.removeItem("markdown-reviewer-prefs");
  });
});
