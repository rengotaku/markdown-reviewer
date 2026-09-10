import { create } from "zustand";
import { persist } from "zustand/middleware";

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
  /**
   * How the comment pane lays out anchored cards (#298): "aligned" keeps each
   * card's vertical position level with the paragraph it's attached to
   * (Notion-style rail); "list" is the plain top-to-bottom list the pane used
   * before. Aligned is the default — a short screen or an orphan-only file
   * still reads fine as a list, so the choice is left switchable rather than
   * replacing one with the other.
   */
  commentRailMode: "aligned" | "list";
  setCommentRailMode: (mode: "aligned" | "list") => void;
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
