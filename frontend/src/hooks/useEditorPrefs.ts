import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * How the comment pane lays out anchored cards: "aligned" keeps each card
 * level with the paragraph it's attached to (#298); "list" stacks every card
 * in document order in one scrollable column (#333 — brought back after #305
 * removed it, against #304's own "don't remove the mode switch"). A dense
 * document overflows the aligned rail, and the list is where all of it can
 * be read in one pass.
 */
export type CommentRailMode = "aligned" | "list";

interface EditorPrefsState {
  centered: boolean;
  toggleCentered: () => void;
  /**
   * Whether the left gutter shows the Markdown source line number of each
   * top-level block (#234). Off by default so the editor looks unchanged for
   * anyone who doesn't want it; persisted alongside `centered`.
   */
  showLineNumbers: boolean;
  toggleLineNumbers: () => void;
  commentRailMode: CommentRailMode;
  setCommentRailMode: (mode: CommentRailMode) => void;
}

export const useEditorPrefs = create<EditorPrefsState>()(
  persist(
    (set) => ({
      centered: true,
      toggleCentered: () => set((s) => ({ centered: !s.centered })),
      showLineNumbers: false,
      toggleLineNumbers: () => set((s) => ({ showLineNumbers: !s.showLineNumbers })),
      commentRailMode: "aligned",
      setCommentRailMode: (mode) => set({ commentRailMode: mode }),
    }),
    { name: "markdown-reviewer-prefs" }
  )
);
