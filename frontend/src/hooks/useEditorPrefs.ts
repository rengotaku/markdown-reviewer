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
}

export const useEditorPrefs = create<EditorPrefsState>()(
  persist(
    (set) => ({
      centered: true,
      toggleCentered: () => set((s) => ({ centered: !s.centered })),
      showLineNumbers: false,
      toggleLineNumbers: () => set((s) => ({ showLineNumbers: !s.showLineNumbers })),
    }),
    {
      name: "markdown-reviewer-prefs",
      merge: (persisted, current) => {
        // Only the current fields are taken from storage, so a pane-layout
        // preference saved by an older build (#413) is ignored.
        const stored = (persisted ?? {}) as Partial<EditorPrefsState>;
        return {
          ...current,
          ...(stored.centered === undefined ? {} : { centered: stored.centered }),
          ...(stored.showLineNumbers === undefined
            ? {}
            : { showLineNumbers: stored.showLineNumbers }),
        };
      },
    }
  )
);
