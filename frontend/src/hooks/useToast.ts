import { create } from "zustand";

export type ToastSeverity = "success" | "info" | "warning" | "error";

export interface ToastAction {
  /** Label rendered as a button inside the snackbar. */
  label: string;
  /** Invoked when the user clicks the action; the toast is dismissed after. */
  onClick: () => void;
}

export interface Toast {
  id: number;
  message: string;
  severity: ToastSeverity;
  /** Optional clickable action — used for "new file detected, click to open" UX. */
  action?: ToastAction;
}

interface ShowOpts {
  action?: ToastAction;
}

interface ToastState {
  toasts: Toast[];
  show: (message: string, severity?: ToastSeverity, opts?: ShowOpts) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToast = create<ToastState>((set) => ({
  toasts: [],
  show: (message, severity = "info", opts) =>
    set((state) => {
      const action = opts?.action;
      // De-dup identical repeat notifications (#178 round 5): action-less
      // toasts sharing the same message+severity as one already queued
      // don't get a second entry piled on — repeatedly clicking "Save"
      // used to queue one toast per click, each with its own 5s timer, so
      // the popup kept reappearing for `5s × click count` after the user
      // stopped. Actioned toasts are excluded on either side (existing or
      // incoming): a click target may differ even if the label matches, so
      // they always get their own entry (e.g. future Sidebar copy actions).
      if (!action) {
        const idx = state.toasts.findIndex(
          (t) => !t.action && t.message === message && t.severity === severity
        );
        if (idx !== -1) {
          // Re-assign the id (not just leave it) so ToastViewport's
          // `key={current.id}` remounts the Snackbar when this is the
          // visible (first) toast, resetting its autoHideDuration timer —
          // otherwise a second identical "Saved" would silently extend
          // nothing and the popup would vanish 5s after the *first* click
          // even though the user just triggered another one. Position in
          // the queue is left untouched.
          const toasts = state.toasts.map((t, i) =>
            i === idx ? { ...t, id: nextId++ } : t
          );
          return { toasts };
        }
      }
      return {
        toasts: [...state.toasts, { id: nextId++, message, severity, action }],
      };
    }),
  dismiss: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));
