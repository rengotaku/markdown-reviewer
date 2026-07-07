import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * How the sidebar lists files:
 * - "tree": hierarchical directory tree (lazy-loaded per directory)
 * - "recent": flat list of every file, newest modification first
 */
export type SidebarViewMode = "tree" | "recent";

interface UIState {
  isSidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
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
      isSidebarOpen: true,
      toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
      setSidebarOpen: (open) => set({ isSidebarOpen: open }),
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
      // Persist view mode and sidebar width; pane visibility and the
      // transient dir highlight intentionally reset each session.
      partialize: (state) => ({
        sidebarViewMode: state.sidebarViewMode,
        sidebarWidth: state.sidebarWidth,
      }),
    }
  )
);
