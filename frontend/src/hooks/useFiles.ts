import { useQuery } from "@tanstack/react-query";
import { listFiles, type FileListResponse } from "@/api";
import { useActiveRoot } from "@/hooks/useActiveRoot";

export const filesQueryKey = (root: string) => ["files", root] as const;

export function useFiles() {
  const { active } = useActiveRoot();
  return useQuery<FileListResponse>({
    queryKey: filesQueryKey(active),
    queryFn: () => listFiles(active),
    enabled: active !== "",
  });
}
