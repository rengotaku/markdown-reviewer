import { apiClient } from "./client";

// Comment API client for the sidecar review model (#50). Comments live in
// review.json, not in the markdown body; these endpoints read/write them.

/** Content-derived anchor locating a comment in the clean canonical body. */
export interface CommentAnchor {
  heading_path: string[];
  snippet: string;
  occurrence: number;
}

export interface CommentReply {
  author?: string;
  date?: string;
  body: string;
}

/** Resolved on-disk location of an anchored comment (null = global/orphan). */
export interface CommentContext {
  heading_path: string[];
  line_range: [number, number];
}

export type CommentStatus = "open" | "resolved";
export type CommentScope = "inline" | "block" | "cross_section" | "global";

export interface CommentJSON {
  id: string;
  scope: CommentScope;
  group_id?: string;
  author?: string;
  date?: string;
  body: string;
  status: CommentStatus;
  replies?: CommentReply[];
  anchor?: CommentAnchor;
  /** Multiple anchors for cross-section comments. */
  anchors?: CommentAnchor[];
  context: CommentContext | null;
  orphan: boolean;
}

export interface CommentsSummary {
  by_scope: Record<string, number>;
  by_status: Record<string, number>;
  total: number;
}

export interface CommentsResponse {
  file: string;
  root: string;
  summary: CommentsSummary;
  comments: CommentJSON[];
}

export interface CreateCommentRequest {
  scope: CommentScope;
  body: string;
  author?: string;
  date?: string;
  group_id?: string;
  anchor?: CommentAnchor;
  anchors?: CommentAnchor[];
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function rootQuery(root: string | undefined, prefix: "?" | "&"): string {
  if (!root) return "";
  return `${prefix}root=${encodeURIComponent(root)}`;
}

export async function listComments(
  path: string,
  root?: string
): Promise<CommentsResponse> {
  return apiClient
    .get(`api/comments/${encodePath(path)}${rootQuery(root, "?")}`)
    .json<CommentsResponse>();
}

export async function createComment(
  path: string,
  req: CreateCommentRequest,
  root?: string
): Promise<CommentJSON> {
  return apiClient
    .post(`api/comments/${encodePath(path)}${rootQuery(root, "?")}`, { json: req })
    .json<CommentJSON>();
}

export async function setCommentStatus(
  path: string,
  id: string,
  status: CommentStatus,
  root?: string
): Promise<CommentJSON> {
  const sep = root ? "&" : "?";
  return apiClient
    .patch(
      `api/comments/${encodePath(path)}${rootQuery(root, "?")}${sep}id=${encodeURIComponent(id)}`,
      { json: { status } }
    )
    .json<CommentJSON>();
}

export async function editCommentBody(
  path: string,
  id: string,
  body: string,
  root?: string
): Promise<CommentJSON> {
  const sep = root ? "&" : "?";
  return apiClient
    .patch(
      `api/comments/${encodePath(path)}${rootQuery(root, "?")}${sep}id=${encodeURIComponent(id)}`,
      { json: { body } }
    )
    .json<CommentJSON>();
}

export async function deleteComment(
  path: string,
  id: string,
  root?: string
): Promise<void> {
  const sep = root ? "&" : "?";
  await apiClient.delete(
    `api/comments/${encodePath(path)}${rootQuery(root, "?")}${sep}id=${encodeURIComponent(id)}`
  );
}

export async function replyToComment(
  path: string,
  id: string,
  reply: CommentReply,
  root?: string
): Promise<CommentJSON> {
  const sep = root ? "&" : "?";
  return apiClient
    .post(
      `api/replies/${encodePath(path)}${rootQuery(root, "?")}${sep}id=${encodeURIComponent(id)}`,
      { json: reply }
    )
    .json<CommentJSON>();
}
