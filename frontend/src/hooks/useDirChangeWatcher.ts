import { useEffect, useRef } from "react";
import { useQueryClient, type QueryCacheNotifyEvent } from "@tanstack/react-query";
import { useToast } from "@/hooks/useToast";
import type { DirListResponse, DirEntryApi } from "@/api";

interface UseDirChangeWatcherOpts {
  /** Called when the user clicks a notification for a markdown file. */
  onOpenFile: (path: string) => void;
  /** Called when the user clicks a notification for a directory. */
  onSelectDir: (path: string) => void;
}

/**
 * Subscribes to the react-query cache and diffs successive `useDir` snapshots
 * for the same query key. When the tree auto-refresh surfaces a new entry or
 * an mtime-changed entry, a clickable toast is shown so the user can jump
 * straight to the change.
 *
 * Subtleties worth knowing about:
 *
 *   - First snapshot per query key is treated as a baseline only — we don't
 *     want a flood of "new file" toasts the instant the app boots.
 *   - Removed entries are intentionally NOT surfaced as toasts. They don't
 *     navigate anywhere useful, and they tend to fire during in-app actions
 *     (saveAs / cleanup) where they'd just be noise.
 *   - Modifications are de-duplicated by `${path}@${mtime}` so the same
 *     change isn't announced twice on consecutive refetches.
 */
export function useDirChangeWatcher({
  onOpenFile,
  onSelectDir,
}: UseDirChangeWatcherOpts) {
  const queryClient = useQueryClient();
  const showToast = useToast((s) => s.show);

  // Last seen entries per dir-query path (the second element of ["dir", path]).
  // Map<dirQueryPath, Map<entryPath, mtime>>
  const snapshotsRef = useRef<Map<string, Map<string, string>>>(new Map());
  // Set of "entryPath@mtime" we've already announced — guards against a query
  // emitting the same data twice (e.g. structuralSharing no-op refetches).
  const announcedRef = useRef<Set<string>>(new Set());

  // Stash the latest callbacks so the cache subscription doesn't have to
  // tear down/re-subscribe each render.
  const callbacksRef = useRef({ onOpenFile, onSelectDir });
  useEffect(() => {
    callbacksRef.current = { onOpenFile, onSelectDir };
  }, [onOpenFile, onSelectDir]);

  useEffect(() => {
    const cache = queryClient.getQueryCache();
    const unsubscribe = cache.subscribe((event: QueryCacheNotifyEvent) => {
      if (event.type !== "updated") return;
      if (event.action.type !== "success") return;
      const key = event.query.queryKey;
      if (!Array.isArray(key) || key[0] !== "dir") return;

      const dirPath = String(key[1] ?? "");
      const data = event.action.data as DirListResponse | undefined;
      if (!data?.entries) return;

      const next = new Map<string, string>();
      for (const e of data.entries) {
        next.set(e.path, e.modified ?? "");
      }

      const prev = snapshotsRef.current.get(dirPath);
      snapshotsRef.current.set(dirPath, next);

      if (!prev) {
        // First snapshot — record as baseline without firing toasts.
        return;
      }

      const changed: DirEntryApi[] = [];
      for (const entry of data.entries) {
        const prevMtime = prev.get(entry.path);
        const sig = `${entry.path}@${entry.modified ?? ""}`;
        if (prevMtime === undefined) {
          // New entry that we didn't know about.
          if (!announcedRef.current.has(sig)) {
            changed.push(entry);
            announcedRef.current.add(sig);
          }
        } else if (prevMtime !== (entry.modified ?? "")) {
          // Existing entry with newer mtime.
          if (!announcedRef.current.has(sig)) {
            changed.push(entry);
            announcedRef.current.add(sig);
          }
        }
      }

      // Bound the announced-set so it doesn't grow unboundedly across a long
      // session. The exact cap doesn't matter — just keep it from leaking.
      if (announcedRef.current.size > 500) {
        announcedRef.current.clear();
      }

      for (const entry of changed) {
        const { onOpenFile: openFile, onSelectDir: selectDir } =
          callbacksRef.current;
        const label = entry.type === "dir" ? "フォルダを開く" : "ファイルを開く";
        const verb =
          prev.has(entry.path) ? "更新" : "追加";
        const kind = entry.type === "dir" ? "フォルダ" : "ファイル";
        showToast(`${kind}を${verb}: ${entry.path}`, "info", {
          action: {
            label,
            onClick: () => {
              if (entry.type === "dir") {
                selectDir(entry.path);
              } else {
                openFile(entry.path);
              }
            },
          },
        });
      }
    });

    return unsubscribe;
  }, [queryClient, showToast]);
}
