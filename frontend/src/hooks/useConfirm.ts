import { create } from "zustand";

interface PendingConfirm {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  resolve: (ok: boolean) => void;
}

interface ConfirmState {
  pending: PendingConfirm | null;
  confirm: (opts: {
    title?: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
  }) => Promise<boolean>;
  resolve: (ok: boolean) => void;
}

export const useConfirm = create<ConfirmState>((set, get) => ({
  pending: null,
  confirm: ({ title = "確認", message, confirmLabel = "OK", cancelLabel = "キャンセル" }) =>
    new Promise<boolean>((resolve) => {
      set({
        pending: { title, message, confirmLabel, cancelLabel, resolve },
      });
    }),
  resolve: (ok) => {
    const pending = get().pending;
    if (!pending) return;
    pending.resolve(ok);
    set({ pending: null });
  },
}));
