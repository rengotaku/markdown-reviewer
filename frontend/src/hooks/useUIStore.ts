import { create } from "zustand";

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
}

export const useUIStore = create<UIState>((set) => ({
  isSidebarOpen: true,
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
  setSidebarOpen: (open) => set({ isSidebarOpen: open }),
  isCommentPaneOpen: true,
  toggleCommentPane: () =>
    set((state) => ({ isCommentPaneOpen: !state.isCommentPaneOpen })),
  setCommentPaneOpen: (open) => set({ isCommentPaneOpen: open }),
  selectedDirPath: null,
  setSelectedDirPath: (path) => set({ selectedDirPath: path }),
}));
