import { describe, it, expect, beforeEach } from "vitest";
import { useUIStore } from "./useUIStore";

describe("useUIStore", () => {
  beforeEach(() => {
    // Reset store state before each test
    useUIStore.setState({ isSidebarOpen: true });
  });

  it("has sidebar open by default", () => {
    const state = useUIStore.getState();
    expect(state.isSidebarOpen).toBe(true);
  });

  it("toggles sidebar state", () => {
    const { toggleSidebar } = useUIStore.getState();

    toggleSidebar();
    expect(useUIStore.getState().isSidebarOpen).toBe(false);

    toggleSidebar();
    expect(useUIStore.getState().isSidebarOpen).toBe(true);
  });

  it("sets sidebar open state directly", () => {
    const { setSidebarOpen } = useUIStore.getState();

    setSidebarOpen(false);
    expect(useUIStore.getState().isSidebarOpen).toBe(false);

    setSidebarOpen(true);
    expect(useUIStore.getState().isSidebarOpen).toBe(true);
  });

  it("toggles and sets the comment pane state", () => {
    useUIStore.setState({ isCommentPaneOpen: true });
    const { toggleCommentPane, setCommentPaneOpen } = useUIStore.getState();

    toggleCommentPane();
    expect(useUIStore.getState().isCommentPaneOpen).toBe(false);
    toggleCommentPane();
    expect(useUIStore.getState().isCommentPaneOpen).toBe(true);

    setCommentPaneOpen(false);
    expect(useUIStore.getState().isCommentPaneOpen).toBe(false);
    setCommentPaneOpen(true);
    expect(useUIStore.getState().isCommentPaneOpen).toBe(true);
  });

  it("tracks the selected directory path", () => {
    useUIStore.setState({ selectedDirPath: null });
    const { setSelectedDirPath } = useUIStore.getState();

    setSelectedDirPath("docs/api");
    expect(useUIStore.getState().selectedDirPath).toBe("docs/api");
    setSelectedDirPath(null);
    expect(useUIStore.getState().selectedDirPath).toBeNull();
  });
});
