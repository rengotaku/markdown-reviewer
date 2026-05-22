import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import { simpleHash } from "@/utils/hash";

export interface OpenFile {
  id: string;
  name: string;
  path: string;
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
  markdown: string;
  modified?: string;
  created?: string;
}

interface OpenFilesState {
  files: OpenFile[];
  activeId: string | null;
  addFiles: (incoming: IncomingFile[]) => void;
  overwriteFiles: (incoming: IncomingFile[]) => void;
  updateActiveMarkdown: (markdown: string) => void;
  setActive: (id: string) => void;
  closeFile: (id: string) => void;
  closeAll: () => void;
  createUntitled: () => void;
  openServerFile: (incoming: IncomingFile) => void;
  markActiveSaved: (modified?: string, created?: string) => void;
  /** Revert the active file's markdown back to its last-saved state. */
  discardActiveChanges: () => void;
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

const UNTITLED_BASE = "untitled";
const UNTITLED_EXT = ".md";
const STORAGE_KEY = "markdown-reviewer-open-files";

function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `file-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function nextUntitledName(existing: Set<string>): string {
  const first = `${UNTITLED_BASE}${UNTITLED_EXT}`;
  if (!existing.has(first)) return first;
  let n = 2;
  while (existing.has(`${UNTITLED_BASE}-${n}${UNTITLED_EXT}`)) n++;
  return `${UNTITLED_BASE}-${n}${UNTITLED_EXT}`;
}

function buildUntitledFile(existing: Set<string>): OpenFile {
  const name = nextUntitledName(existing);
  return {
    id: generateId(),
    name,
    path: name,
    markdown: "",
    savedMarkdown: "",
    isDirty: false,
    reloadToken: 0,
    initialHash: simpleHash(""),
    serverModified: "",
    serverCreated: "",
  };
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

const initialUntitled = buildUntitledFile(new Set());

export const useOpenFiles = create<OpenFilesState>()(
  persist(
    (set) => ({
      files: [initialUntitled],
      activeId: initialUntitled.id,

      addFiles: (incoming) =>
        set((state) => {
          if (incoming.length === 0) return state;
          const created: OpenFile[] = incoming.map((item) => ({
            id: generateId(),
            name: item.name,
            path: item.path ?? item.name,
            markdown: item.markdown,
            savedMarkdown: item.markdown,
            isDirty: false,
            reloadToken: 0,
            initialHash: simpleHash(item.markdown),
            serverModified: item.modified ?? "",
            serverCreated: item.created ?? "",
          }));
          const files = [...state.files, ...created];
          return { files, activeId: created[0].id };
        }),

      overwriteFiles: (incoming) =>
        set((state) => {
          if (incoming.length === 0) return state;
          const byName = new Map(
            incoming.map((item) => [item.name, item] as const)
          );
          const files = state.files.map((file) => {
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
          const firstOverwritten = files.find((f) => byName.has(f.name));
          return {
            files,
            activeId: firstOverwritten ? firstOverwritten.id : state.activeId,
          };
        }),

      updateActiveMarkdown: (markdown) =>
        set((state) => {
          if (!state.activeId) return state;
          const files = state.files.map((file) =>
            file.id === state.activeId
              ? { ...file, markdown, isDirty: markdown !== file.savedMarkdown }
              : file
          );
          return { files };
        }),

      setActive: (id) =>
        set((state) => {
          if (!state.files.some((file) => file.id === id)) return state;
          if (state.activeId === id) return state;
          return { activeId: id };
        }),

      closeFile: (id) =>
        set((state) => {
          const index = state.files.findIndex((file) => file.id === id);
          if (index === -1) return state;
          const remaining = state.files.filter((file) => file.id !== id);
          if (remaining.length === 0) {
            const fresh = buildUntitledFile(new Set());
            return { files: [fresh], activeId: fresh.id };
          }
          let activeId = state.activeId;
          if (state.activeId === id) {
            const nextIndex = Math.min(index, remaining.length - 1);
            activeId = remaining[nextIndex].id;
          }
          return { files: remaining, activeId };
        }),

      closeAll: () =>
        set(() => {
          const fresh = buildUntitledFile(new Set());
          return { files: [fresh], activeId: fresh.id };
        }),

      createUntitled: () =>
        set((state) => {
          const existing = new Set(state.files.map((f) => f.name));
          const fresh = buildUntitledFile(existing);
          return { files: [...state.files, fresh], activeId: fresh.id };
        }),

      openServerFile: (incoming) =>
        set((state) => {
          const path = incoming.path ?? incoming.name;
          const existing = state.files.find((f) => f.path === path);
          if (existing) {
            if (state.activeId === existing.id) return state;
            return { activeId: existing.id };
          }
          const created: OpenFile = {
            id: generateId(),
            name: incoming.name,
            path,
            markdown: incoming.markdown,
            savedMarkdown: incoming.markdown,
            isDirty: false,
            reloadToken: 0,
            initialHash: simpleHash(incoming.markdown),
            serverModified: incoming.modified ?? "",
            serverCreated: incoming.created ?? "",
          };
          return { files: [...state.files, created], activeId: created.id };
        }),

      markActiveSaved: (modified, created) =>
        set((state) => {
          if (!state.activeId) return state;
          return {
            files: state.files.map((file) =>
              file.id === state.activeId
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

      discardActiveChanges: () =>
        set((state) => {
          if (!state.activeId) return state;
          return {
            files: state.files.map((file) =>
              file.id === state.activeId
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
      partialize: (state) => ({
        files: state.files,
        activeId: state.activeId,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        if (state.files.length === 0) {
          const fresh = buildUntitledFile(new Set());
          state.files = [fresh];
          state.activeId = fresh.id;
          return;
        }
        state.files = state.files.map((f) => ({
          ...(f.path ? f : { ...f, path: f.name }),
          initialHash: f.initialHash ?? simpleHash(f.markdown),
          // Older persisted entries don't have savedMarkdown. Treat the
          // last-persisted markdown as the saved baseline.
          savedMarkdown: f.savedMarkdown ?? f.markdown,
          // Older persisted entries don't have serverModified. The next
          // watcher poll will populate it from the live stat response.
          serverModified: f.serverModified ?? "",
          serverCreated: f.serverCreated ?? "",
        }));
        if (!state.activeId || !state.files.some((f) => f.id === state.activeId)) {
          state.activeId = state.files[0].id;
        }
      },
    }
  )
);
