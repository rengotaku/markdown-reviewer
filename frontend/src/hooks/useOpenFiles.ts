import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import { simpleHash } from "@/utils/hash";

export interface OpenFile {
  id: string;
  name: string;
  path: string;
  /**
   * Name of the configured root this file belongs to. Determines which
   * `?root=<name>` is sent on subsequent reads/writes/stats and is what
   * drives "show only this root's tabs in the editor" filtering.
   *
   * Empty string is reserved for entries persisted by an older single-root
   * build; reattachLegacyFilesToRoot moves them onto the default root once
   * /api/config arrives.
   */
  root: string;
  markdown: string;
  /** The last persisted ("clean") markdown — what `markdown` reverts to on discard. */
  savedMarkdown: string;
  isDirty: boolean;
  reloadToken: number;
  initialHash: string;
  /**
   * RFC3339 mtime of the file on disk as of the last read/write. Used by the
   * external-change watcher to decide whether a poll-found newer mtime
   * counts as an external edit. Empty string for files that don't have a
   * server-side counterpart yet (e.g. fresh "untitled" buffers).
   */
  serverModified: string;
  /**
   * RFC3339 birth time when the OS records one (darwin); empty otherwise.
   * Surfaced in the editor header alongside serverModified.
   */
  serverCreated: string;
}

export interface IncomingFile {
  name: string;
  path?: string;
  root: string;
  markdown: string;
  modified?: string;
  created?: string;
}

interface OpenFilesState {
  files: OpenFile[];
  /**
   * Last-active file id per root, so switching root tabs restores the file
   * the user was looking at without dropping the open-file list for the
   * other root.
   */
  activeIdByRoot: Record<string, string | null>;
  addFiles: (incoming: IncomingFile[]) => void;
  overwriteFiles: (root: string, incoming: IncomingFile[]) => void;
  updateActiveMarkdown: (root: string, markdown: string) => void;
  setActive: (root: string, id: string) => void;
  closeFile: (id: string) => void;
  closeAll: () => void;
  openServerFile: (incoming: IncomingFile) => void;
  markActiveSaved: (
    root: string,
    modified?: string,
    created?: string
  ) => void;
  /** Revert the given root's active file's markdown back to its last-saved state. */
  discardActiveChanges: (root: string) => void;
  /**
   * Apply an externally-edited reload to the given file: replace markdown +
   * savedMarkdown, clear isDirty, bump reloadToken, and record the new
   * serverModified. Used when the watcher detects an external change.
   */
  applyExternalReload: (
    id: string,
    markdown: string,
    modified: string,
    created?: string
  ) => void;
  /**
   * Record a new serverModified without touching the file's contents — used
   * when the user chooses to keep their unsaved edits over an external
   * change, so the watcher doesn't keep re-firing on the same mtime.
   */
  acknowledgeExternalChange: (id: string, modified: string) => void;
}

const STORAGE_KEY = "markdown-reviewer-open-files";

function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `file-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

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
      console.warn(`[useOpenFiles] Failed to persist '${name}':`, error);
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

export const useOpenFiles = create<OpenFilesState>()(
  persist(
    (set) => ({
      files: [],
      activeIdByRoot: {},

      addFiles: (incoming) =>
        set((state) => {
          if (incoming.length === 0) return state;
          const created: OpenFile[] = incoming.map((item) => ({
            id: generateId(),
            name: item.name,
            path: item.path ?? item.name,
            root: item.root,
            markdown: item.markdown,
            savedMarkdown: item.markdown,
            isDirty: false,
            reloadToken: 0,
            initialHash: simpleHash(item.markdown),
            serverModified: item.modified ?? "",
            serverCreated: item.created ?? "",
          }));
          const files = [...state.files, ...created];
          const first = created[0];
          return {
            files,
            activeIdByRoot: { ...state.activeIdByRoot, [first.root]: first.id },
          };
        }),

      overwriteFiles: (root, incoming) =>
        set((state) => {
          if (incoming.length === 0) return state;
          const byName = new Map(
            incoming.map((item) => [item.name, item] as const)
          );
          const files = state.files.map((file) => {
            if (file.root !== root) return file;
            const item = byName.get(file.name);
            if (item === undefined) return file;
            return {
              ...file,
              markdown: item.markdown,
              savedMarkdown: item.markdown,
              isDirty: false,
              reloadToken: file.reloadToken + 1,
              serverModified: item.modified ?? file.serverModified,
              serverCreated: item.created ?? file.serverCreated,
            };
          });
          const firstOverwritten = files.find(
            (f) => f.root === root && byName.has(f.name)
          );
          if (!firstOverwritten) return { files };
          return {
            files,
            activeIdByRoot: {
              ...state.activeIdByRoot,
              [root]: firstOverwritten.id,
            },
          };
        }),

      updateActiveMarkdown: (root, markdown) =>
        set((state) => {
          const activeId = state.activeIdByRoot[root];
          if (!activeId) return state;
          const files = state.files.map((file) =>
            file.id === activeId
              ? { ...file, markdown, isDirty: markdown !== file.savedMarkdown }
              : file
          );
          return { files };
        }),

      setActive: (root, id) =>
        set((state) => {
          if (!state.files.some((file) => file.id === id && file.root === root)) {
            return state;
          }
          if (state.activeIdByRoot[root] === id) return state;
          return {
            activeIdByRoot: { ...state.activeIdByRoot, [root]: id },
          };
        }),

      closeFile: (id) =>
        set((state) => {
          const target = state.files.find((file) => file.id === id);
          if (!target) return state;
          const remaining = state.files.filter((file) => file.id !== id);
          const sameRoot = state.files.filter((f) => f.root === target.root);
          const index = sameRoot.findIndex((f) => f.id === id);
          const sameRootRemaining = sameRoot.filter((f) => f.id !== id);

          const nextActiveId = (() => {
            if (state.activeIdByRoot[target.root] !== id) {
              return state.activeIdByRoot[target.root];
            }
            if (sameRootRemaining.length === 0) return null;
            const fallback = Math.min(index, sameRootRemaining.length - 1);
            return sameRootRemaining[fallback].id;
          })();

          return {
            files: remaining,
            activeIdByRoot: {
              ...state.activeIdByRoot,
              [target.root]: nextActiveId,
            },
          };
        }),

      closeAll: () => set(() => ({ files: [], activeIdByRoot: {} })),

      openServerFile: (incoming) =>
        set((state) => {
          const path = incoming.path ?? incoming.name;
          const existing = state.files.find(
            (f) => f.path === path && f.root === incoming.root
          );
          if (existing) {
            if (state.activeIdByRoot[incoming.root] === existing.id) return state;
            return {
              activeIdByRoot: {
                ...state.activeIdByRoot,
                [incoming.root]: existing.id,
              },
            };
          }
          const created: OpenFile = {
            id: generateId(),
            name: incoming.name,
            path,
            root: incoming.root,
            markdown: incoming.markdown,
            savedMarkdown: incoming.markdown,
            isDirty: false,
            reloadToken: 0,
            initialHash: simpleHash(incoming.markdown),
            serverModified: incoming.modified ?? "",
            serverCreated: incoming.created ?? "",
          };
          return {
            files: [...state.files, created],
            activeIdByRoot: {
              ...state.activeIdByRoot,
              [incoming.root]: created.id,
            },
          };
        }),

      markActiveSaved: (root, modified, created) =>
        set((state) => {
          const activeId = state.activeIdByRoot[root];
          if (!activeId) return state;
          return {
            files: state.files.map((file) =>
              file.id === activeId
                ? {
                    ...file,
                    savedMarkdown: file.markdown,
                    isDirty: false,
                    initialHash: simpleHash(file.markdown),
                    serverModified: modified ?? file.serverModified,
                    serverCreated: created ?? file.serverCreated,
                  }
                : file
            ),
          };
        }),

      discardActiveChanges: (root) =>
        set((state) => {
          const activeId = state.activeIdByRoot[root];
          if (!activeId) return state;
          return {
            files: state.files.map((file) =>
              file.id === activeId
                ? {
                    ...file,
                    markdown: file.savedMarkdown,
                    isDirty: false,
                    reloadToken: file.reloadToken + 1,
                  }
                : file
            ),
          };
        }),

      applyExternalReload: (id, markdown, modified, created) =>
        set((state) => {
          if (!state.files.some((f) => f.id === id)) return state;
          return {
            files: state.files.map((file) =>
              file.id === id
                ? {
                    ...file,
                    markdown,
                    savedMarkdown: markdown,
                    isDirty: false,
                    reloadToken: file.reloadToken + 1,
                    initialHash: simpleHash(markdown),
                    serverModified: modified,
                    serverCreated: created ?? file.serverCreated,
                  }
                : file
            ),
          };
        }),

      acknowledgeExternalChange: (id, modified) =>
        set((state) => {
          if (!state.files.some((f) => f.id === id)) return state;
          return {
            files: state.files.map((file) =>
              file.id === id ? { ...file, serverModified: modified } : file
            ),
          };
        }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => safeLocalStorage),
      version: 2,
      // Older persisted state (version 1) stored `activeId: string` instead
      // of `activeIdByRoot`, and OpenFile entries had no `root` field.
      // Migrate by parking every legacy entry on a placeholder root ("").
      // The first /api/config load reassigns them to the default root via
      // reattachLegacyFilesToRoot.
      migrate: (state, version) => {
        if (version >= 2 || !state) return state as OpenFilesState;
        const legacy = state as unknown as {
          files?: OpenFile[];
          activeId?: string | null;
        };
        const files = (legacy.files ?? []).map((f) => ({
          ...f,
          root: f.root ?? "",
        }));
        const activeIdByRoot: Record<string, string | null> = {};
        if (legacy.activeId) activeIdByRoot[""] = legacy.activeId;
        return {
          ...state,
          files,
          activeIdByRoot,
        } as unknown as OpenFilesState;
      },
      partialize: (state) => ({
        files: state.files,
        activeIdByRoot: state.activeIdByRoot,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        state.files = state.files.map((f) => ({
          ...(f.path ? f : { ...f, path: f.name }),
          // Older persisted entries don't have `root`; default to "" and let
          // the editor reattach them once /api/config arrives.
          root: f.root ?? "",
          initialHash: f.initialHash ?? simpleHash(f.markdown),
          // Older persisted entries don't have savedMarkdown. Treat the
          // last-persisted markdown as the saved baseline.
          savedMarkdown: f.savedMarkdown ?? f.markdown,
          // Older persisted entries don't have serverModified. The next
          // watcher poll will populate it from the live stat response.
          serverModified: f.serverModified ?? "",
          serverCreated: f.serverCreated ?? "",
        }));
        state.activeIdByRoot = state.activeIdByRoot ?? {};
        // Drop stale active ids whose files have been closed/removed.
        for (const [root, id] of Object.entries(state.activeIdByRoot)) {
          if (id && !state.files.some((f) => f.id === id)) {
            state.activeIdByRoot[root] = null;
          }
        }
      },
    }
  )
);

/**
 * Re-home any persisted files that didn't carry a `root` field (legacy
 * single-root persistence) onto the given default root. Idempotent — files
 * that already have a non-empty root are left alone.
 */
export function reattachLegacyFilesToRoot(defaultRoot: string) {
  if (!defaultRoot) return;
  const state = useOpenFiles.getState();
  const filesNeedRoot = state.files.some((f) => !f.root);
  const legacyActive = state.activeIdByRoot[""];
  if (!filesNeedRoot && !legacyActive) return;
  const files = state.files.map((f) => (f.root ? f : { ...f, root: defaultRoot }));
  const nextActiveByRoot = { ...state.activeIdByRoot };
  if (legacyActive) {
    if (!nextActiveByRoot[defaultRoot]) nextActiveByRoot[defaultRoot] = legacyActive;
    delete nextActiveByRoot[""];
  }
  useOpenFiles.setState({ files, activeIdByRoot: nextActiveByRoot });
}
