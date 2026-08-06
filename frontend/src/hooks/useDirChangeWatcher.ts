import { useEffect, useRef } from "react";
import { useQueryClient, type QueryCacheNotifyEvent } from "@tanstack/react-query";
import { useChangedPaths } from "@/hooks/useChangedPaths";
import type { DirListResponse } from "@/api";

/**
 * Subscribes to the react-query cache and diffs successive `useDir` snapshots
 * for the same query key. When the tree auto-refresh surfaces a new entry or
 * an mtime-changed entry (file OR directory), it is recorded in the
 * changed-paths store (#178) so the sidebar can show a passive "unread" dot
 * instead of a toast popup — saves/directory churn no longer interrupt the
 * editor with a stream of notifications.
 *
 * Subtleties worth knowing about:
 *
 *   - First snapshot per query key is treated as a baseline only — we don't
 *     want the whole tree marked "changed" the instant the app boots.
 *   - Removed entries are intentionally NOT marked. They don't correspond to
 *     anything the user can still open, and they tend to fire during in-app
 *     actions (saveAs / cleanup) where they'd just be noise.
 *   - Directory entries ARE marked directly, not just derived from their
 *     children (#178 round 2 fix): while a directory is collapsed, its
 *     `useDir` query never mounts, so a change to a file inside it (e.g. an
 *     external editor saving `docs/foo.md` while `docs/` sits collapsed) is
 *     only ever observable here as `docs`'s own mtime moving. Skipping
 *     directory entries would silently drop that signal and the unread dot
 *     would never appear. useChangedPaths.hasChangedUnder additionally ORs
 *     in any already-known marked descendant once a directory is expanded.
 *   - Modifications are de-duplicated by `${path}@${mtime}` so the same
 *     change isn't processed twice on consecutive refetches.
 *   - A diff that exactly matches a registered self-write signature (#178 —
 *     this app's own atomic save, whose PUT response and the next dir
 *     refetch report the same root/path/mtime) is consumed instead of
 *     marked, so saving a file from inside the app doesn't light up its own
 *     unread dot.
 */
export function useDirChangeWatcher() {
  const queryClient = useQueryClient();
  const mark = useChangedPaths((s) => s.mark);
  const consumeSelfWrite = useChangedPaths((s) => s.consumeSelfWrite);

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

      for (const entry of data.entries) {
        // Files and directories are marked the same way (see docstring
        // above) — a directory's own mtime moving is treated as "something
        // changed underneath" while it's collapsed and its children aren't
        // individually observable yet.
        const prevMtime = prev.get(entry.path);
        const isNew = prevMtime === undefined;
        const isModified = !isNew && prevMtime !== (entry.modified ?? "");
        if (!isNew && !isModified) continue;

        const sig = `${entry.path}@${entry.modified ?? ""}`;
        if (announcedRef.current.has(sig)) continue;
        announcedRef.current.add(sig);

        if (consumeSelfWrite(dirRoot, entry.path, entry.modified ?? "")) continue;
        mark(dirRoot, entry.path);
      }

      // Bound the announced-set so it doesn't grow unboundedly across a long
      // session. The exact cap doesn't matter — just keep it from leaking.
      if (announcedRef.current.size > 500) {
        announcedRef.current.clear();
      }
    });

    return unsubscribe;
  }, [queryClient, mark, consumeSelfWrite]);
}
