import { useQuery } from "@tanstack/react-query";
import { listDir, type DirListResponse } from "@/api";
import { useActiveRoot } from "@/hooks/useActiveRoot";
import { useServerConnection } from "@/hooks/useServerConnection";

export const dirQueryKey = (root: string, path: string) =>
  ["dir", root, path] as const;

/**
 * Interval at which mounted dir queries refetch in the background so the
 * sidebar picks up filesystem changes (new / removed / renamed files) made
 * outside the app without requiring the user to hit the refresh button.
 *
 * 30s matches staleTime so a fresh read isn't immediately considered stale,
 * and `refetchIntervalInBackground: false` pauses polling when the tab is
 * hidden — no point asking the server for changes the user can't see.
 *
 * This is the polling *fallback*: once the SSE channel (issue #112,
 * useServerEvents) is connected, `tree` events invalidate this query
 * directly and the interval below is disabled so we're not double-driving
 * the same cache entry.
 */
export const DIR_REFETCH_INTERVAL_MS = 30_000;

export function useDir(path: string, opts?: { enabled?: boolean }) {
  const { active } = useActiveRoot();
  const sseConnected = useServerConnection((s) => s.connected);
  return useQuery<DirListResponse>({
    queryKey: dirQueryKey(active, path),
    queryFn: () => listDir(path, active),
    // Wait until /api/config has provided a non-empty root so we don't fire
    // a default-root request that we'd then immediately abandon.
    enabled: (opts?.enabled ?? true) && active !== "",
    staleTime: DIR_REFETCH_INTERVAL_MS,
    refetchInterval: sseConnected ? false : DIR_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
}
