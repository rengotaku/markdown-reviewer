import { useEffect, useRef } from "react";
import { readFile, statFile } from "@/api";
import { useOpenFiles } from "@/hooks/useOpenFiles";
import { useActiveRoot } from "@/hooks/useActiveRoot";
import { useChangedPaths } from "@/hooks/useChangedPaths";
import { useConfirm } from "@/hooks/useConfirm";
import { useToast } from "@/hooks/useToast";

/**
 * Default poll cadence. 5s strikes a balance between latency (the user sees
 * an external edit reasonably quickly) and load (a single cheap HEAD-style
 * stat per interval per open tab). Exported so tests can override.
 */
export const FILE_WATCHER_INTERVAL_MS = 5000;

/**
 * Polls the active file's on-disk state and reconciles external edits:
 *
 *   - clean (not dirty): silently re-fetch and replace the buffer; surface
 *     a low-noise toast so the user knows something changed under them.
 *   - dirty: show a confirm dialog letting the user pick between accepting
 *     the external version (their edits are discarded) and keeping their
 *     own edits (the external mtime/sha is acknowledged so the dialog
 *     doesn't re-open on every subsequent tick).
 *
 * Change detection is sha-first when both sides know a sha (#119): the
 * content hash tells a real external edit (even one that lands in the same
 * mtime second — a same-second double save) apart from a plain "touch"
 * (mtime bumped, bytes unchanged, e.g. `touch` or a metadata-only rewrite),
 * which is now a silent no-op instead of a spurious reload/dialog. Tabs
 * without a known sha yet (rehydrated from an older persisted session, or
 * talking to a server that predates #119) fall back to the previous
 * mtime-only comparison, backfilling serverSha once it's learned so later
 * ticks can use the sha-first path.
 *
 * Untitled / unsaved buffers (serverModified === "") are skipped.
 *
 * `opts.paused` stops the interval entirely (issue #112: once the SSE
 * channel is connected, the push-driven `file` event replaces this poll —
 * see `opts.trigger` below — so re-polling every intervalMs would just be
 * redundant /api/stat traffic). `opts.trigger` fires one immediate tick
 * each time it changes to a new value, letting a caller (EditorPage's
 * useServerEvents onFile handler) drive the exact same reconcile logic
 * on demand instead of waiting for the next interval.
 */
export function useFileWatcher(
  intervalMs: number = FILE_WATCHER_INTERVAL_MS,
  opts?: { paused?: boolean; trigger?: number }
) {
  const confirm = useConfirm((s) => s.confirm);
  const showToast = useToast((s) => s.show);
  // #178 round 2: an active-tab file the watcher just reconciled (either by
  // silently taking the external content, or by the user explicitly
  // deciding to ignore it) is no longer "unread" — clear its sidebar dot
  // alongside the existing reconcile logic below.
  const clearChanged = useChangedPaths((s) => s.clear);
  const { active: activeRoot } = useActiveRoot();
  const paused = opts?.paused ?? false;
  const trigger = opts?.trigger ?? 0;

  // The dialog is async. Without this guard the next tick can stack a
  // second dialog on top while the first one is still awaiting user input.
  const pendingPathRef = useRef<string | null>(null);

  // Whether the hook itself is gone (#201). Distinct from the per-effect-run
  // `cancelled` flag below, which flips on every dependency change —
  // including `trigger` (a second `file` event for the same path) and
  // `paused` (a visibilitychange, or the SSE channel dropping/reconnecting),
  // both of which happen routinely while the confirm dialog is on screen.
  // Anything awaited *across the dialog* must key off unmount, not off
  // `cancelled`, or the user's answer is silently discarded and — because
  // the re-run's immediate tick is blocked by pendingPathRef above — the
  // dialog never comes back either.
  const unmountedRef = useRef(false);
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      if (!activeRoot) return;
      const state = useOpenFiles.getState();
      const activeId = state.activeIdByRoot[activeRoot];
      const active = state.files.find((f) => f.id === activeId);
      if (!active) return;
      // Untitled or otherwise not-yet-persisted buffers have no server
      // mtime to compare against — nothing to watch.
      if (!active.serverModified) return;
      // Don't re-issue while a previous tick's dialog is still open for the
      // same file.
      if (pendingPathRef.current === active.path) return;

      let stat;
      try {
        stat = await statFile(active.path, active.root);
      } catch {
        // Transient network / 404 (file was deleted out from under us, etc.)
        // Bail silently — the user will see other failures (save etc.) the
        // next time they try to interact with the file.
        return;
      }
      if (cancelled) return;

      // Re-read the latest state in case something raced in between (e.g.
      // user switched tabs, saved, or a previous tick already reconciled
      // this exact file).
      const live = useOpenFiles
        .getState()
        .files.find((f) => f.id === active.id);
      if (!live) return;

      const shaKnownBothSides = Boolean(stat.sha && live.serverSha);
      if (shaKnownBothSides) {
        // sha-first (#119): the content hash is authoritative. Catches a
        // same-second double save (identical mtime, different content) and
        // ignores a plain touch (mtime bumped, bytes unchanged).
        if (stat.sha === live.serverSha) {
          if (stat.modified && stat.modified !== live.serverModified) {
            useOpenFiles
              .getState()
              .acknowledgeExternalChange(live.id, stat.modified, stat.sha);
            // #178 round 4: a `touch` (or a rewrite with identical bytes) on
            // the file the user is actively viewing was already confirmed
            // content-unchanged right here — there is nothing to tell the
            // user is "unread", so clear any mark an earlier tree/dir-diff
            // signal may have set for it.
            clearChanged(live.root, live.path);
          }
          return;
        }
      } else {
        // No sha to compare on one (or both) sides — a server predating
        // #119, or a tab rehydrated from an older persisted session. Fall
        // back to the mtime-only comparison used before #119.
        if (!stat.modified || stat.modified === live.serverModified) {
          // Nothing changed by mtime. If the server *did* report a sha (only
          // this tab lacks its baseline), backfill it silently so future
          // ticks can take the sha-first path above.
          if (stat.sha && !live.serverSha) {
            useOpenFiles
              .getState()
              .acknowledgeExternalChange(live.id, live.serverModified, stat.sha);
            // #178 round 4: same rationale as the sha-match touch case above
            // — this backfill only runs when the mtime hasn't moved at all,
            // so there is no external change to report as unread either.
            clearChanged(live.root, live.path);
          }
          return;
        }
      }

      if (!live.isDirty) {
        try {
          const fresh = await readFile(live.path, live.root);
          if (cancelled) return;
          useOpenFiles
            .getState()
            .applyExternalReload(
              live.id,
              fresh.content,
              fresh.modified,
              fresh.created,
              fresh.sha
            );
          clearChanged(live.root, live.path);
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
      // Deliberately not `cancelled` — see unmountedRef above (#201).
      if (unmountedRef.current) return;

      if (accept) {
        try {
          const fresh = await readFile(live.path, live.root);
          if (unmountedRef.current) return;
          useOpenFiles
            .getState()
            .applyExternalReload(
              live.id,
              fresh.content,
              fresh.modified,
              fresh.created,
              fresh.sha
            );
          clearChanged(live.root, live.path);
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
        // Acknowledge what is on disk *now*, not the pre-dialog stat. The
        // dialog can stay up across further external writes, and the trigger
        // each of those fires is swallowed by the pendingPathRef guard above
        // — so acking the stale sha would leave the newest external change
        // undetected until some later event (the interval is off whenever
        // SSE is connected). A re-stat failure falls back to the pre-dialog
        // values: acking something slightly stale only makes the next tick
        // re-prompt, which is the safe direction.
        let seen = stat;
        try {
          seen = await statFile(live.path, live.root);
        } catch {
          // keep `stat`
        }
        // Checked outside the try so the failure path is covered too.
        if (unmountedRef.current) return;
        useOpenFiles
          .getState()
          .acknowledgeExternalChange(live.id, seen.modified, seen.sha);
        // The user explicitly decided to ignore this external change (#178
        // round 2) — it's been seen and dismissed, not left unread.
        clearChanged(live.root, live.path);
        showToast(
          `「${live.name}」の編集を保持しました（外部変更は無視）`,
          "warning"
        );
      }
    };

    // trigger > 0 means a caller (useServerEvents' onFile handler) asked for
    // an out-of-cycle check right now, on top of (or instead of) the
    // interval below — e.g. the SSE channel just told us this exact file
    // changed, so there's no reason to wait for the next interval tick.
    if (trigger > 0) {
      void tick();
    }

    if (paused) {
      return () => {
        cancelled = true;
      };
    }

    const handle = window.setInterval(() => {
      void tick();
    }, intervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [activeRoot, confirm, showToast, clearChanged, intervalMs, paused, trigger]);
}
