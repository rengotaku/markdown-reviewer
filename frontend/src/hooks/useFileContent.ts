import { useMutation } from "@tanstack/react-query";
import { readFile, writeFile, type FileReadResponse } from "@/api";

export function useReadFile() {
  return useMutation<FileReadResponse, Error, { path: string; root?: string }>({
    mutationFn: ({ path, root }) => readFile(path, root),
  });
}

export function useWriteFile() {
  return useMutation<
    FileReadResponse,
    Error,
    { path: string; content: string; root?: string; ifMatch?: string }
  >({
    mutationFn: ({ path, content, root, ifMatch }) =>
      writeFile(path, content, root, undefined, ifMatch),
  });
}
