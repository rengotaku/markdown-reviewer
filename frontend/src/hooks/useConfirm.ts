import { create } from "zustand";

interface PendingConfirm {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  resolve: (ok: boolean) => void;
}

interface ConfirmState {
  /**
   * FIFO queue of confirm() calls awaiting a user response. `pending` (the
   * field ConfirmDialog reads) always mirrors `queue[0]` — only one dialog
   * is ever shown at a time; later confirm() calls wait their turn instead
   * of clobbering whatever is currently on screen.
   *
   * Without this queue, a second confirm() firing while the first is still
   * awaiting the user (e.g. the external-change watcher's dialog popping up
   * moments after a save-conflict dialog) would overwrite `pending` outright:
   * the first dialog disappears without the user ever answering it, and its
   * caller's `await confirm(...)` never resolves because the resolver it
   * held was silently discarded (issue #119 follow-up).
   */
  queue: PendingConfirm[];
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
  queue: [],
  pending: null,
  confirm: ({ title = "確認", message, confirmLabel = "OK", cancelLabel = "キャンセル" }) =>
    new Promise<boolean>((resolve) => {
      const queue = [...get().queue, { title, message, confirmLabel, cancelLabel, resolve }];
      set({ queue, pending: queue[0] });
    }),
  resolve: (ok) => {
    const [current, ...rest] = get().queue;
    if (!current) return;
    current.resolve(ok);
    set({ queue: rest, pending: rest[0] ?? null });
  },
}));
