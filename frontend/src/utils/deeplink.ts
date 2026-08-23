export function buildCommentDeepLink(
  origin: string,
  root: string,
  path: string,
  commentId: string
): string {
  const base = origin.replace(/\/+$/, "");
  const params = new URLSearchParams();
  params.set("root", root);
  params.set("select_file", path);
  params.set("comment_id", commentId);
  return `${base}/?${params.toString()}`;
}
