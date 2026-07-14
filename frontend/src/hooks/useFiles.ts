import { useQuery } from "@tanstack/react-query";
import { listFiles, type FileListResponse } from "@/api";
import { useActiveRoot } from "@/hooks/useActiveRoot";
import { DIR_REFETCH_INTERVAL_MS } from "@/hooks/useDir";
import { useServerConnection } from "@/hooks/useServerConnection";

export const filesQueryKey = (root: string) => ["files", root] as const;

export function useFiles() {
  const { active } = useActiveRoot();
  const sseConnected = useServerConnection((s) => s.connected);
  return useQuery<FileListResponse>({
    queryKey: filesQueryKey(active),
    queryFn: () => listFiles(active),
    enabled: active !== "",
    // Poll on the same cadence as the dir tree (useDir) so the sidebar's
    // "recent" list picks up out-of-band filesystem changes in step with
    // the tree view. Disabled once SSE is connected — see useDir's comment
    // on the same trade-off.
    staleTime: DIR_REFETCH_INTERVAL_MS,
    refetchInterval: sseConnected ? false : DIR_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
}
