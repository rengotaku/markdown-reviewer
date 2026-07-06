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

/** Managed-review lifecycle state of a file. */
export type ReviewState = "draft" | "review";

export interface FileReadResponse {
  path: string;
  content: string;
  modified: string;
  /** RFC3339 birth time when the OS records one (darwin); "" otherwise. */
  created: string;
  root: string;
  /** "draft" until ingested, then "review". Older servers omit it. */
  state?: ReviewState;
}

export interface FileStatResponse {
  path: string;
  modified: string;
  /** RFC3339 birth time when the OS records one (darwin); "" otherwise. */
  created: string;
  root: string;
  state?: ReviewState;
}

export interface IngestResponse {
  path: string;
  root: string;
  state: ReviewState;
}

/** One revision's metadata (content omitted) from the revisions listing. */
export interface RevisionMeta {
  id: string;
  ts: string;
  author: string;
}

export interface RevisionListResponse {
  path: string;
  root: string;
  revisions: RevisionMeta[];
}

export interface RevisionResponse {
  id: string;
  ts: string;
  author: string;
  content: string;
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
  root?: string,
  // Browser saves are always human actions; label the revision snapshot as
  // such so history doesn't fall back to the server's "unknown" default.
  author = "human"
): Promise<FileReadResponse> {
  const rootParam = rootQuery(root, "?");
  const authorParam = `${rootParam ? "&" : "?"}author=${encodeURIComponent(author)}`;
  return apiClient
    .put(`api/files/${encodePath(path)}${rootParam}${authorParam}`, {
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

/**
 * ingestFile puts a draft file under managed review (creates its entry under
 * ~/.config/reviewer). Idempotent — re-ingesting returns state="review".
 */
export async function ingestFile(
  path: string,
  root?: string
): Promise<IngestResponse> {
  return apiClient
    .post(`api/ingest/${encodePath(path)}${rootQuery(root, "?")}`)
    .json<IngestResponse>();
}

/** listRevisions returns the file's saved snapshots, newest first. */
export async function listRevisions(
  path: string,
  root?: string
): Promise<RevisionListResponse> {
  return apiClient
    .get(`api/revisions/${encodePath(path)}${rootQuery(root, "?")}`)
    .json<RevisionListResponse>();
}

/** getRevision returns one snapshot's (AI-hint-stripped) content. */
export async function getRevision(
  path: string,
  id: string,
  root?: string
): Promise<RevisionResponse> {
  const sep = root ? "&" : "?";
  return apiClient
    .get(
      `api/revisions/${encodePath(path)}${rootQuery(root, "?")}${sep}id=${encodeURIComponent(id)}`
    )
    .json<RevisionResponse>();
}
