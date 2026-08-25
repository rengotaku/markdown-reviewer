import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";

/** One previously-opened file, newest first within its root. */
export interface RecentOpenedEntry {
  root: string;
  path: string;
  name: string;
  /** RFC3339 timestamp of the last time this file was opened/activated. */
  openedAt: string;
}

/** How many entries the sidebar's "Recently" section keeps, per root. */
export const RECENT_OPENED_LIMIT = 20;

interface RecentOpenedState {
  entries: RecentOpenedEntry[];
  /**
   * Record that `path` was opened in `root`. Moves an already-recorded file
   * back to the front (rather than duplicating it) and trims that root's
   * history to RECENT_OPENED_LIMIT. Other roots' entries are untouched.
   */
  record: (root: string, path: string, name: string) => void;
  /** Entries for one root, newest first, capped at RECENT_OPENED_LIMIT. */
  listForRoot: (root: string) => RecentOpenedEntry[];
  /** Forget one file (used when the server says the path no longer exists). */
  remove: (root: string, path: string) => void;
  clear: () => void;
}

const STORAGE_KEY = "markdown-reviewer-recent-opened";

const safeLocalStorage: StateStorage = {
  getItem: (name) => {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value);
    } catch (error) {
      console.warn(`[useRecentOpened] Failed to persist '${name}':`, error);
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name);
    } catch {
      // noop
    }
  },
};

export const useRecentOpened = create<RecentOpenedState>()(
  persist(
    (set, get) => ({
      entries: [],

      record: (root, path, name) =>
        set((state) => {
          if (!root || !path) return state;
          const entry: RecentOpenedEntry = {
            root,
            path,
            name,
            openedAt: new Date().toISOString(),
          };
          const sameRoot = state.entries
            .filter((e) => e.root === root && e.path !== path)
            .slice(0, RECENT_OPENED_LIMIT - 1);
          const others = state.entries.filter((e) => e.root !== root);
          return { entries: [entry, ...sameRoot, ...others] };
        }),

      listForRoot: (root) =>
        get()
          .entries.filter((e) => e.root === root)
          .slice(0, RECENT_OPENED_LIMIT),

      remove: (root, path) =>
        set((state) => {
          const entries = state.entries.filter(
            (e) => !(e.root === root && e.path === path)
          );
          if (entries.length === state.entries.length) return state;
          return { entries };
        }),

      clear: () => set({ entries: [] }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => safeLocalStorage),
      version: 1,
      partialize: (state) => ({ entries: state.entries }),
    }
  )
);
