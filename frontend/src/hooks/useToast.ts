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
    set((state) => ({
      toasts: [
        ...state.toasts,
        { id: nextId++, message, severity, action: opts?.action },
      ],
    })),
  dismiss: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));
