import { apiClient } from "./client";

export interface FileEntry {
  path: string;
  size: number;
  modified: string;
}

export interface FileListResponse {
  files: FileEntry[];
}

export interface FileReadResponse {
  path: string;
  content: string;
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export async function listFiles(): Promise<FileListResponse> {
  return apiClient.get("api/files").json<FileListResponse>();
}

export async function readFile(path: string): Promise<FileReadResponse> {
  return apiClient.get(`api/files/${encodePath(path)}`).json<FileReadResponse>();
}

export async function writeFile(path: string, content: string): Promise<FileReadResponse> {
  return apiClient
    .put(`api/files/${encodePath(path)}`, { json: { content } })
    .json<FileReadResponse>();
}
