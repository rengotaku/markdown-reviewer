import { useEffect, useRef } from "react";
import { useQueryClient, type QueryCacheNotifyEvent } from "@tanstack/react-query";
import { useChangedPaths } from "@/hooks/useChangedPaths";
import type { DirListResponse } from "@/api";

/**
 * Subscribes to the react-query cache and diffs successive `useDir` snapshots
 * for the same query key. When the tree auto-refresh surfaces a new file or
 * an mtime-changed file, it is recorded in the changed-paths store (#178) so
 * the sidebar can show a passive "unread" dot instead of a toast popup —
 * saves/directory churn no longer interrupt the editor with a stream of
 * notifications.
 *
 * #178 round 3: this dir-diff subscription is now the **polling fallback**
 * only. The primary signal is EditorPage's SSE `onTree` handler, which
 * carries the exact changed file's root/path/mtime from the server
 * regardless of the sidebar tree's expand/collapse state. This hook still
 * runs (SSE and dir-polling are not mutually exclusive — see useDir), so it
 * keeps marking files itself for the window before SSE connects and for any
 * deployment where SSE never connects (proxies that buffer/drop
 * `text/event-stream`, etc).
 *
 * Trade-off (accepted): while running degraded without SSE, a change to a
 * file inside a *collapsed* directory is invisible here — that directory's
 * own `useDir` query never mounts, so nothing in this snapshot diff observes
 * it. SSE is a localhost connection to the launchd-managed daemon and is
 * expected to be connected almost always, so this gap is considered
 * acceptable rather than also marking directories to route around it (marking
 * directories directly was tried and reverted — see #178 round 2 vs round 3 —
 * because it has no reliable way to tell an external change in a directory
 * apart from this app's own save touching that same directory's mtime via
 * its atomic write).
 *
 * Subtleties worth knowing about:
 *
 *   - First snapshot per query key is treated as a baseline only — we don't
 *     want the whole tree marked "changed" the instant the app boots.
 *   - Directory entries are never marked directly (see trade-off above) —
 *     only files drive the changed-set from this source.
 *   - Entries that disappear from a listing (deleted/renamed away) are not
 *     marked, but any *existing* mark on them is cleared (#178 round 3): a
 *     mark on a path nobody can open again would otherwise linger forever,
 *     keeping an ancestor directory's dot lit via
 *     useChangedPaths.hasChangedUnder with no way for the user to ever clear
 *     it by opening the file.
 *   - Modifications are de-duplicated by `${path}@${mtime}` so the same
 *     change isn't processed twice on consecutive refetches.
 *   - A diff that matches a registered self-write signature (#178 — this
 *     app's own atomic save, whose PUT response and a later dir refetch
 *     report the same root/path/mtime) is skipped instead of marked, so
 *     saving a file from inside the app doesn't light up its own unread dot.
 *     The signature check is non-destructive (round 3): the same save can
 *     also be echoed via the SSE `tree` event, so it must still match here
 *     too.
 */
export function useDirChangeWatcher() {
  const queryClient = useQueryClient();
  const mark = useChangedPaths((s) => s.mark);
  const clear = useChangedPaths((s) => s.clear);
  const isSelfWrite = useChangedPaths((s) => s.isSelfWrite);

  // Last seen entries per dir-query path (the second element of ["dir", path]).
  // Map<dirQueryPath, Map<entryPath, mtime>>
  const snapshotsRef = useRef<Map<string, Map<string, string>>>(new Map());
  // Set of "entryPath@mtime" we've already processed — guards against a query
  // emitting the same data twice (e.g. structuralSharing no-op refetches).
  const announcedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const cache = queryClient.getQueryCache();
    const unsubscribe = cache.subscribe((event: QueryCacheNotifyEvent) => {
      if (event.type !== "updated") return;
      if (event.action.type !== "success") return;
      const key = event.query.queryKey;
      if (!Array.isArray(key) || key[0] !== "dir") return;

      // dirQueryKey is ["dir", root, path]. Older snapshots used
      // ["dir", path] (no root segment) so we tolerate both: when the third
      // element is missing, fall back to the second.
      const dirRoot = key.length >= 3 ? String(key[1] ?? "") : "";
      const dirPath = key.length >= 3 ? String(key[2] ?? "") : String(key[1] ?? "");
      const snapshotKey = `${dirRoot}::${dirPath}`;
      const data = event.action.data as DirListResponse | undefined;
      if (!data?.entries) return;

      const next = new Map<string, string>();
      for (const e of data.entries) {
        next.set(e.path, e.modified ?? "");
      }

      const prev = snapshotsRef.current.get(snapshotKey);
      snapshotsRef.current.set(snapshotKey, next);

      if (!prev) {
        // First snapshot — record as baseline without marking anything.
        return;
      }

      // Entries that vanished from the listing can never be opened again —
      // clear any mark they still carry (#178 round 3) rather than marking
      // them (existing behavior, unchanged).
      for (const path of prev.keys()) {
        if (!next.has(path)) {
          clear(dirRoot, path);
        }
      }

      for (const entry of data.entries) {
        // Directories are never marked directly here — see this hook's
        // docstring for the trade-off.
        if (entry.type === "dir") continue;

        const prevMtime = prev.get(entry.path);
        const isNew = prevMtime === undefined;
        const isModified = !isNew && prevMtime !== (entry.modified ?? "");
        if (!isNew && !isModified) continue;

        const sig = `${entry.path}@${entry.modified ?? ""}`;
        if (announcedRef.current.has(sig)) continue;
        announcedRef.current.add(sig);

        if (isSelfWrite(dirRoot, entry.path, entry.modified ?? "")) continue;
        mark(dirRoot, entry.path);
      }

      // Bound the announced-set so it doesn't grow unboundedly across a long
      // session. The exact cap doesn't matter — just keep it from leaking.
      if (announcedRef.current.size > 500) {
        announcedRef.current.clear();
      }
    });

    return unsubscribe;
  }, [queryClient, mark, clear, isSelfWrite]);
}
