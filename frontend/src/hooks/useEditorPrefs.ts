import { create } from "zustand";
import { persist } from "zustand/middleware";

interface EditorPrefsState {
  centered: boolean;
  toggleCentered: () => void;
}

export const useEditorPrefs = create<EditorPrefsState>()(
  persist(
    (set) => ({
      centered: true,
      toggleCentered: () => set((s) => ({ centered: !s.centered })),
    }),
    { name: "markdown-reviewer-prefs" }
  )
);
