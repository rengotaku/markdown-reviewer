import { create } from "zustand";

export type ToastSeverity = "success" | "info" | "warning" | "error";

export interface Toast {
  id: number;
  message: string;
  severity: ToastSeverity;
}

interface ToastState {
  toasts: Toast[];
  show: (message: string, severity?: ToastSeverity) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToast = create<ToastState>((set) => ({
  toasts: [],
  show: (message, severity = "info") =>
    set((state) => ({
      toasts: [...state.toasts, { id: nextId++, message, severity }],
    })),
  dismiss: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));
