/** Builds a shareable Web UI URL that opens `path` under `root` and jumps to
 *  `commentId`. `root` and `path` become the URL's path segments
 *  (`encodeURIComponent` so `/` in `path` round-trips as `%2F` — see
 *  EditorPage's splat decoding); `comment_id` stays a query param since it
 *  targets something *within* the opened file, not the file itself. */
export function buildCommentDeepLink(
  origin: string,
  root: string,
  path: string,
  commentId: string
): string {
  const base = origin.replace(/\/+$/, "");
  const params = new URLSearchParams();
  params.set("comment_id", commentId);
  return `${base}/${encodeURIComponent(root)}/${encodeURIComponent(path)}?${params.toString()}`;
}
