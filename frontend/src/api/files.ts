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
  modified: string;
  /** RFC3339 birth time when the OS records one (darwin); "" otherwise. */
  created: string;
}

export interface FileStatResponse {
  path: string;
  modified: string;
  /** RFC3339 birth time when the OS records one (darwin); "" otherwise. */
  created: string;
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export interface ConfigResponse {
  review_root_name: string;
  review_root: string;
}

export interface DirEntry {
  name: string;
  path: string;
  type: "dir" | "file";
  modified: string;
}

export interface DirListResponse {
  entries: DirEntry[];
}

export async function getConfig(): Promise<ConfigResponse> {
  return apiClient.get("api/config").json<ConfigResponse>();
}

export async function listDir(path: string): Promise<DirListResponse> {
  const search = path ? `?path=${encodePath(path)}` : "";
  return apiClient.get(`api/dirs${search}`).json<DirListResponse>();
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

export async function statFile(path: string): Promise<FileStatResponse> {
  return apiClient.get(`api/stat/${encodePath(path)}`).json<FileStatResponse>();
}
