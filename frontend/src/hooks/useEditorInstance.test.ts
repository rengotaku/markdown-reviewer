import { describe, it, expect, beforeEach } from "vitest";
import { useEditorInstance } from "./useEditorInstance";

describe("useEditorInstance", () => {
  beforeEach(() => {
    useEditorInstance.setState({ editor: null, scrollToTopToken: 0 });
  });

  it("starts with scrollToTopToken of 0", () => {
    expect(useEditorInstance.getState().scrollToTopToken).toBe(0);
  });

  it("requestScrollToTop increments scrollToTopToken", () => {
    useEditorInstance.getState().requestScrollToTop();
    expect(useEditorInstance.getState().scrollToTopToken).toBe(1);

    useEditorInstance.getState().requestScrollToTop();
    expect(useEditorInstance.getState().scrollToTopToken).toBe(2);
  });
});
