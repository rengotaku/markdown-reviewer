/**
 * Warning shown when a comment the user just created cannot be placed (#404).
 *
 * A comment can fail to land in two ways, and both have to be checked:
 *   - the server could not resolve its anchor and stored it as orphan
 *     (inline comments are posted with allow_orphan, so this is not an error
 *     response — just `orphan: true`)
 *   - the server resolved it, possibly after repairing it, but the anchor it
 *     hands back does not resolve in the editor's document, so no highlight
 *     appears and the comment shows up as 位置不明 anyway. Before #404 a
 *     heading written as `&gt;` did exactly this: the server's repaired
 *     heading_path said `&gt;` while the editor's heading said `>`.
 *
 * With unsaved edits either can be transient (the server has not seen the
 * text yet), so the warning is only raised on a saved buffer. Saying so at once
 * is what makes the next editor/server disagreement visible instead of
 * surfacing later as an unexplained 位置不明 comment.
 */
export const ORPHAN_ON_CREATE_MESSAGE =
  "コメントを本文の位置に紐付けられず、位置不明として保存しました。選択した箇所の記法がサーバ側の照合と一致していない可能性があります";

export function orphanOnCreateWarning(
  created: { orphan?: boolean } | null | undefined,
  hadUnsavedEdits: boolean,
  resolvesInEditor: boolean
): string | null {
  if (!created || hadUnsavedEdits) return null;
  if (!created.orphan && resolvesInEditor) return null;
  return ORPHAN_ON_CREATE_MESSAGE;
}
