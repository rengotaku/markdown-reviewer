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
});
