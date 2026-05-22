import { useEffect, useRef } from "react";
import { readFile, statFile } from "@/api";
import { useOpenFiles } from "@/hooks/useOpenFiles";
import { useConfirm } from "@/hooks/useConfirm";
import { useToast } from "@/hooks/useToast";

/**
 * Default poll cadence. 5s strikes a balance between latency (the user sees
 * an external edit reasonably quickly) and load (a single cheap HEAD-style
 * stat per interval per open tab). Exported so tests can override.
 */
export const FILE_WATCHER_INTERVAL_MS = 5000;

/**
 * Polls the active file's on-disk mtime and reconciles external edits:
 *
 *   - clean (not dirty): silently re-fetch and replace the buffer; surface
 *     a low-noise toast so the user knows something changed under them.
 *   - dirty: show a confirm dialog letting the user pick between accepting
 *     the external version (their edits are discarded) and keeping their
 *     own edits (the external mtime is acknowledged so the dialog doesn't
 *     re-open on every subsequent tick).
 *
 * Untitled / unsaved buffers (serverModified === "") are skipped.
 */
export function useFileWatcher(intervalMs: number = FILE_WATCHER_INTERVAL_MS) {
  const confirm = useConfirm((s) => s.confirm);
  const showToast = useToast((s) => s.show);

  // The dialog is async. Without this guard the next tick can stack a
  // second dialog on top while the first one is still awaiting user input.
  const pendingPathRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      const state = useOpenFiles.getState();
      const active = state.files.find((f) => f.id === state.activeId);
      if (!active) return;
      // Untitled or otherwise not-yet-persisted buffers have no server
      // mtime to compare against — nothing to watch.
      if (!active.serverModified) return;
      // Don't re-issue while a previous tick's dialog is still open for the
      // same file.
      if (pendingPathRef.current === active.path) return;

      let stat;
      try {
        stat = await statFile(active.path);
      } catch {
        // Transient network / 404 (file was deleted out from under us, etc.)
        // Bail silently — the user will see other failures (save etc.) the
        // next time they try to interact with the file.
        return;
      }
      if (cancelled) return;
      if (!stat.modified || stat.modified === active.serverModified) return;

      // Re-read the latest state in case something raced in between
      // (e.g. user switched tabs or saved).
      const live = useOpenFiles
        .getState()
        .files.find((f) => f.id === active.id);
      if (!live) return;
      if (live.serverModified === stat.modified) return;

      if (!live.isDirty) {
        try {
          const fresh = await readFile(live.path);
          if (cancelled) return;
          useOpenFiles
            .getState()
            .applyExternalReload(live.id, fresh.content, fresh.modified);
          showToast(
            `「${live.name}」が外部で更新されたため再読み込みしました`,
            "info"
          );
        } catch (err) {
          showToast(
            `外部更新の取り込みに失敗しました: ${
              (err as Error).message ?? "unknown error"
            }`,
            "error"
          );
        }
        return;
      }

      pendingPathRef.current = live.path;
      const accept = await confirm({
        title: "ファイルが外部から更新されました",
        message: `「${live.name}」が外部で変更されました。\n自分の編集を破棄して外部変更を取り込みますか？`,
        confirmLabel: "外部変更を取り込む",
        cancelLabel: "自分の編集を保持",
      });
      pendingPathRef.current = null;
      if (cancelled) return;

      if (accept) {
        try {
          const fresh = await readFile(live.path);
          if (cancelled) return;
          useOpenFiles
            .getState()
            .applyExternalReload(live.id, fresh.content, fresh.modified);
          showToast(`「${live.name}」を外部の最新内容で再読み込みしました`, "info");
        } catch (err) {
          showToast(
            `外部更新の取り込みに失敗しました: ${
              (err as Error).message ?? "unknown error"
            }`,
            "error"
          );
        }
      } else {
        useOpenFiles
          .getState()
          .acknowledgeExternalChange(live.id, stat.modified);
        showToast(
          `「${live.name}」の編集を保持しました（外部変更は無視）`,
          "warning"
        );
      }
    };

    const handle = window.setInterval(() => {
      void tick();
    }, intervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [confirm, showToast, intervalMs]);
}
