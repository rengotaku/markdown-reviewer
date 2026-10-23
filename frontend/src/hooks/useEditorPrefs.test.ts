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

  it("defaults the comment pane to the paragraph-aligned layout and switches to the list (#333)", () => {
    // Fresh default, read from the store's initializer rather than whatever
    // an earlier test left behind.
    expect(useEditorPrefs.getInitialState().commentRailMode).toBe("aligned");
    useEditorPrefs.getState().setCommentRailMode("list");
    expect(useEditorPrefs.getState().commentRailMode).toBe("list");
    useEditorPrefs.getState().setCommentRailMode("aligned");
  });
});
