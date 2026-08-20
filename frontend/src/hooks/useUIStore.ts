import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * How the sidebar lists files:
 * - "tree": hierarchical directory tree (lazy-loaded per directory)
 * - "recent": flat list of every file, newest modification first
 */
export type SidebarViewMode = "tree" | "recent";

interface UIState {
  /**
   * Whether the sidebar's hover-triggered overlay is currently shown (#219).
   * This is *not* the sidebar's overall visibility — when `sidebarPinned` is
   * true the sidebar is always visible via the push layout regardless of
   * this flag. It only matters while unpinned: the hover-panel guard
   * (useHoverPanel) flips this on/off as the pointer enters/leaves the hot
   * zone and the panel itself. Intentionally not persisted (transient,
   * pointer-driven state — see `partialize` below).
   */
  isSidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  /** Whether the sidebar is pinned open as a push layout (vs. only shown as
   *  a transient hover overlay). Persisted so returning users keep the
   *  layout they left the app in. Defaults to true so existing users land
   *  on the same push-layout look they had before #219. */
  sidebarPinned: boolean;
  setSidebarPinned: (pinned: boolean) => void;
  toggleSidebarPinned: () => void;
  isCommentPaneOpen: boolean;
  toggleCommentPane: () => void;
  setCommentPaneOpen: (open: boolean) => void;
  /**
   * Folder path currently highlighted in the sidebar. Used so that opening a
   * toast notification for a newly-detected directory can scroll & expand the
   * tree to surface that directory. Null when no directory is "selected"
   * (which is the default — file selection is tracked separately by activePath).
   */
  selectedDirPath: string | null;
  setSelectedDirPath: (path: string | null) => void;
  /** Sidebar listing mode (#68). Persisted so the choice survives reloads. */
  sidebarViewMode: SidebarViewMode;
  setSidebarViewMode: (mode: SidebarViewMode) => void;
  /** Sidebar pixel width, adjustable via drag handle. Persisted across reloads. */
  sidebarWidth: number;
  setSidebarWidth: (w: number) => void;
}

const STORAGE_KEY = "markdown-reviewer-ui";

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      isSidebarOpen: false,
      toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
      setSidebarOpen: (open) => set({ isSidebarOpen: open }),
      sidebarPinned: true,
      setSidebarPinned: (pinned) => set({ sidebarPinned: pinned }),
      toggleSidebarPinned: () => set((state) => ({ sidebarPinned: !state.sidebarPinned })),
      isCommentPaneOpen: true,
      toggleCommentPane: () =>
        set((state) => ({ isCommentPaneOpen: !state.isCommentPaneOpen })),
      setCommentPaneOpen: (open) => set({ isCommentPaneOpen: open }),
      selectedDirPath: null,
      setSelectedDirPath: (path) => set({ selectedDirPath: path }),
      sidebarViewMode: "tree",
      setSidebarViewMode: (mode) => set({ sidebarViewMode: mode }),
      sidebarWidth: 280,
      setSidebarWidth: (w) => set({ sidebarWidth: w }),
    }),
    {
      name: STORAGE_KEY,
      version: 1,
      // Persist view mode, sidebar width and pin state; pane visibility, the
      // transient dir highlight, and the hover-overlay's isSidebarOpen flag
      // intentionally reset each session (#219: re-opening the app should
      // never resume mid-hover).
      partialize: (state) => ({
        sidebarViewMode: state.sidebarViewMode,
        sidebarWidth: state.sidebarWidth,
        sidebarPinned: state.sidebarPinned,
      }),
    }
  )
);
