import { useQuery } from "@tanstack/react-query";
import { listDir, type DirListResponse } from "@/api";

export const dirQueryKey = (path: string) => ["dir", path] as const;

export function useDir(path: string, opts?: { enabled?: boolean }) {
  return useQuery<DirListResponse>({
    queryKey: dirQueryKey(path),
    queryFn: () => listDir(path),
    enabled: opts?.enabled ?? true,
    staleTime: 30_000,
  });
}
