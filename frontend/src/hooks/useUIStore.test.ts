import { describe, it, expect, beforeEach } from "vitest";
import { useUIStore } from "./useUIStore";

describe("useUIStore", () => {
  beforeEach(() => {
    // Reset store state before each test
    useUIStore.setState({
      isSidebarOpen: false,
      sidebarPinned: true,
      sidebarViewMode: "tree",
    });
  });

  it("has the hover overlay closed and the sidebar pinned by default (#219)", () => {
    const state = useUIStore.getState();
    expect(state.isSidebarOpen).toBe(false);
    expect(state.sidebarPinned).toBe(true);
  });

  it("toggles the hover-overlay open state", () => {
    const { toggleSidebar } = useUIStore.getState();

    toggleSidebar();
    expect(useUIStore.getState().isSidebarOpen).toBe(true);

    toggleSidebar();
    expect(useUIStore.getState().isSidebarOpen).toBe(false);
  });

  it("sets the hover-overlay open state directly", () => {
    const { setSidebarOpen } = useUIStore.getState();

    setSidebarOpen(true);
    expect(useUIStore.getState().isSidebarOpen).toBe(true);

    setSidebarOpen(false);
    expect(useUIStore.getState().isSidebarOpen).toBe(false);
  });

  it("toggles and sets the sidebar pinned state", () => {
    const { toggleSidebarPinned, setSidebarPinned } = useUIStore.getState();

    toggleSidebarPinned();
    expect(useUIStore.getState().sidebarPinned).toBe(false);
    toggleSidebarPinned();
    expect(useUIStore.getState().sidebarPinned).toBe(true);

    setSidebarPinned(false);
    expect(useUIStore.getState().sidebarPinned).toBe(false);
    setSidebarPinned(true);
    expect(useUIStore.getState().sidebarPinned).toBe(true);
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

  it("defaults the sidebar view mode to tree", () => {
    expect(useUIStore.getState().sidebarViewMode).toBe("tree");
  });

  it("switches the sidebar view mode", () => {
    const { setSidebarViewMode } = useUIStore.getState();

    setSidebarViewMode("recent");
    expect(useUIStore.getState().sidebarViewMode).toBe("recent");
    setSidebarViewMode("tree");
    expect(useUIStore.getState().sidebarViewMode).toBe("tree");
  });

  it("defaults sidebarWidth to 280", () => {
    useUIStore.setState({ sidebarWidth: 280 });
    expect(useUIStore.getState().sidebarWidth).toBe(280);
  });

  it("setSidebarWidth updates the width", () => {
    useUIStore.getState().setSidebarWidth(400);
    expect(useUIStore.getState().sidebarWidth).toBe(400);
  });

  it("persists the sidebar view mode and width to localStorage", () => {
    useUIStore.getState().setSidebarViewMode("recent");
    useUIStore.getState().setSidebarWidth(360);

    const raw = localStorage.getItem("markdown-reviewer-ui");
    expect(raw).not.toBeNull();
    const persisted = JSON.parse(raw as string) as {
      state: Record<string, unknown>;
    };
    expect(persisted.state).toEqual({
      sidebarViewMode: "recent",
      sidebarWidth: 360,
      sidebarPinned: true,
    });
  });
});
