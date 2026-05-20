import { useQuery } from "@tanstack/react-query";
import { listFiles, type FileListResponse } from "@/api";

export const filesQueryKey = ["files"] as const;

export function useFiles() {
  return useQuery<FileListResponse>({
    queryKey: filesQueryKey,
    queryFn: listFiles,
  });
}
