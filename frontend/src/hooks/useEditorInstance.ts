import type { Editor } from "@tiptap/react";
import { create } from "zustand";

/**
 * A pending request to open a root-relative path in the editor, raised by an
 * in-app link click or "Open" from the link preview modal (#213). `token`
 * is bumped on every request so re-requesting the same path (e.g. clicking
 * the same link twice) still re-fires the subscriber's effect.
 */
export interface OpenPathRequest {
  path: string;
  token: number;
}

interface EditorInstanceState {
  editor: Editor | null;
  setEditor: (editor: Editor | null) => void;
  scrollToTopToken: number;
  requestScrollToTop: () => void;
  openPathRequest: OpenPathRequest | null;
  /** Raise a request to open `path`. EditorPage subscribes and routes it
   *  through its existing handleSelect (unsaved-changes confirm, etc.). */
  requestOpenPath: (path: string) => void;
  /** Clear the pending request once EditorPage has acted on it, so the same
   *  request object doesn't re-fire on an unrelated re-render. */
  clearOpenPathRequest: () => void;
  /**
   * Flush the active editor's debounced Markdown resync into `useOpenFiles`
   * immediately (#265). A no-op until TiptapEditor mounts and registers its
   * real implementation via `setFlushPendingMarkdown`. Callers that need the
   * store's `markdown` field to be current -- save, tab switch, close tab,
   * page unload -- call this first.
   */
  flushPendingMarkdown: () => void;
  /** Registered by TiptapEditor so other components can force a flush
   *  without owning the editor instance themselves. */
  setFlushPendingMarkdown: (fn: () => void) => void;
}

export const useEditorInstance = create<EditorInstanceState>((set) => ({
  editor: null,
  setEditor: (editor) => set({ editor }),
  scrollToTopToken: 0,
  requestScrollToTop: () =>
    set((state) => ({ scrollToTopToken: state.scrollToTopToken + 1 })),
  openPathRequest: null,
  requestOpenPath: (path) =>
    set((state) => ({
      openPathRequest: { path, token: state.openPathRequest ? state.openPathRequest.token + 1 : 1 },
    })),
  clearOpenPathRequest: () => set({ openPathRequest: null }),
  flushPendingMarkdown: () => {},
  setFlushPendingMarkdown: (fn) => set({ flushPendingMarkdown: fn }),
}));
