import { apiClient } from "./client";

export interface FileEntry {
  path: string;
  size: number;
  modified: string;
}

export interface FileListResponse {
  files: FileEntry[];
  root: string;
}

export interface FileReadResponse {
  path: string;
  content: string;
  modified: string;
  /** RFC3339 birth time when the OS records one (darwin); "" otherwise. */
  created: string;
  root: string;
}

export interface FileStatResponse {
  path: string;
  modified: string;
  /** RFC3339 birth time when the OS records one (darwin); "" otherwise. */
  created: string;
  root: string;
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

// rootQuery returns the `?root=<name>` (or `&root=<name>`) suffix that the
// server-side handlers use to route a request to a specific named root.
// Empty / undefined → no suffix (server picks the default).
function rootQuery(root: string | undefined, prefix: "?" | "&"): string {
  if (!root) return "";
  return `${prefix}root=${encodeURIComponent(root)}`;
}

/** One configured root surfaced by /api/config. */
export interface ReviewRootEntry {
  name: string;
  path: string;
}

export interface ConfigResponse {
  /** Legacy: name (or basename) of the default root. */
  review_root_name: string;
  /** Legacy: absolute path of the default root. */
  review_root: string;
  /** Full list of configured roots, in declaration order. */
  review_roots: ReviewRootEntry[];
}

export interface DirEntry {
  name: string;
  path: string;
  type: "dir" | "file";
  modified: string;
}

export interface DirListResponse {
  entries: DirEntry[];
  root: string;
}

export async function getConfig(): Promise<ConfigResponse> {
  return apiClient.get("api/config").json<ConfigResponse>();
}

export async function listDir(
  path: string,
  root?: string
): Promise<DirListResponse> {
  const pathParam = path ? `path=${encodePath(path)}` : "";
  const rootParam = rootQuery(root, pathParam ? "&" : "?");
  const search = pathParam ? `?${pathParam}${rootParam}` : rootQuery(root, "?");
  return apiClient.get(`api/dirs${search}`).json<DirListResponse>();
}

export async function listFiles(root?: string): Promise<FileListResponse> {
  return apiClient
    .get(`api/files${rootQuery(root, "?")}`)
    .json<FileListResponse>();
}

export async function readFile(
  path: string,
  root?: string
): Promise<FileReadResponse> {
  return apiClient
    .get(`api/files/${encodePath(path)}${rootQuery(root, "?")}`)
    .json<FileReadResponse>();
}

export async function writeFile(
  path: string,
  content: string,
  root?: string
): Promise<FileReadResponse> {
  return apiClient
    .put(`api/files/${encodePath(path)}${rootQuery(root, "?")}`, {
      json: { content },
    })
    .json<FileReadResponse>();
}

export async function statFile(
  path: string,
  root?: string
): Promise<FileStatResponse> {
  return apiClient
    .get(`api/stat/${encodePath(path)}${rootQuery(root, "?")}`)
    .json<FileStatResponse>();
}
