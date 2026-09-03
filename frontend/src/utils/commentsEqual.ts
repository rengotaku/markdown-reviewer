import type { CommentJSON } from "@/api/comments";

/**
 * True when two comment lists carry the same content.
 *
 * Adding a comment refetches the sidecar twice: once because the mutation
 * handler asks for it, and once because the server's file watcher sees
 * review.json change and pushes an SSE `comments` event back to the very
 * browser that wrote it (internal/events/watcher.go does not know who wrote
 * the file). The two responses are identical, but each JSON.parse yields a
 * fresh array, so a plain setComments made every consumer of `comments`
 * re-run — including the effect that re-resolves every comment anchor against
 * the whole document (#270).
 *
 * Comparing serialized form is deliberate: the shape is plain JSON straight
 * off the wire, so this catches every field (replies included) without having
 * to keep a hand-written field list in sync with the API. It runs once per
 * refetch, not per keystroke.
 */
export function commentsEqual(
  a: ReadonlyArray<CommentJSON>,
  b: ReadonlyArray<CommentJSON>
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
