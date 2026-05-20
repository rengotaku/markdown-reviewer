import { useMutation } from "@tanstack/react-query";
import { readFile, writeFile, type FileReadResponse } from "@/api";

export function useReadFile() {
  return useMutation<FileReadResponse, Error, string>({
    mutationFn: (path) => readFile(path),
  });
}

export function useWriteFile() {
  return useMutation<FileReadResponse, Error, { path: string; content: string }>({
    mutationFn: ({ path, content }) => writeFile(path, content),
  });
}
