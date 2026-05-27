import { useQuery } from "@tanstack/react-query";
import { listDir, type DirListResponse } from "@/api";
import { useActiveRoot } from "@/hooks/useActiveRoot";

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
 */
export const DIR_REFETCH_INTERVAL_MS = 30_000;

export function useDir(path: string, opts?: { enabled?: boolean }) {
  const { active } = useActiveRoot();
  return useQuery<DirListResponse>({
    queryKey: dirQueryKey(active, path),
    queryFn: () => listDir(path, active),
    // Wait until /api/config has provided a non-empty root so we don't fire
    // a default-root request that we'd then immediately abandon.
    enabled: (opts?.enabled ?? true) && active !== "",
    staleTime: DIR_REFETCH_INTERVAL_MS,
    refetchInterval: DIR_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
}
