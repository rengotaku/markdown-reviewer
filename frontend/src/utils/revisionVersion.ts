/**
 * Parse a revision ID (`r-NNN`, assigned by the server's `nextID()`) into its
 * numeric suffix. Returns null if the ID doesn't match the expected shape
 * (defensive: should not happen with server-generated IDs, but keeps callers
 * from having to special-case a throw).
 */
export function parseRevisionId(id: string): number | null {
  const m = /^r-(\d+)$/.exec(id);
  if (!m) return null;
  return parseInt(m[1], 10);
}

/**
 * Compute the version number shown in the editor header (`v{N}`).
 *
 * `revisions.length + 1` breaks once history.jsonl hits
 * `internal/reviewstore.MaxRevisions` (20): older entries get trimmed on
 * append, so the array length caps at 20 even though the file may already be
 * on its 25th save (#143 codex review round 2 — this silently froze the
 * displayed version at v21). Revision IDs are assigned by the server as one
 * past the highest numeric suffix retained so far, so they keep increasing
 * monotonically across the trim. Deriving N from the newest retained
 * revision's ID (`revisions[0]`, since `ListRevisions` returns newest-first)
 * instead of the array length keeps the number correct past MaxRevisions.
 *
 * A flat `id + 1` is itself wrong for about half of real usage (#143 codex
 * review round 3), because a revision is appended two different ways and
 * only one of them snapshots content that is *older* than what's on screen:
 *   - Browser save (`PUT /api/files`): snapshots the **pre-save** body before
 *     writing the new one (`internal/handler/helpdoc/api.md` "保存時に「前回
 *     保存内容」をリビジョン履歴へスナップショットする"). The current body is
 *     therefore one version *ahead of* the newest revision → `id + 1`.
 *   - External edit sync (`SyncExternalEdit`, the AI's normal in-place-edit
 *     path — `internal/reviewstore/syncexternal.go`): appends the **current**
 *     body as-is (`AppendRevision(root, relPath, externalAuthor, stripped)`
 *     where `stripped` is the just-read file). The current body therefore
 *     *is* the newest revision → plain `id`, no `+1`.
 * There is no separate "which path produced this revision" field, so we
 * infer it the same way the server itself detects drift
 * (`syncexternal.go`'s `newest.Sha == shortSha(stripped)`): compare the
 * newest revision's (hint-stripped) content against the current (hint-
 * stripped) body with strict string equality. A match means the external-
 * edit path fired last (content unchanged since that snapshot) → no `+1`; a
 * mismatch means a browser save happened since (or the content was fetched
 * before landing) → `+1`.
 *
 * `newestContent`/`currentText` are expected to already be hint-stripped by
 * the caller (e.g. via `stripHint`); this function does no stripping itself.
 * `newestContent: undefined` is treated as "not matching" (same as the
 * browser-save default) for the `revisions.length === 0` (no-history) case,
 * where there is nothing to fetch and this is simply how "no newest
 * revision" is expressed. For any file *with* history, an undefined
 * `newestContent` means the newest revision's content genuinely hasn't
 * arrived yet (still in flight, or its fetch failed) — callers MUST NOT call
 * this function in that state, since guessing `+1` here can end up wrong and,
 * once shown, never self-corrects (see `versionReady`/`displayVersion` in
 * EditorPage, which gates on `newestRevisionContent !== undefined` whenever
 * `revisions.length > 0`).
 *
 * Falls back to `revisions.length` (match) / `revisions.length + 1`
 * (no match) if the newest ID doesn't parse.
 */
export function computeDisplayVersion(
  revisions: readonly { id: string }[],
  newestContent: string | undefined,
  currentText: string
): number {
  if (revisions.length === 0) return 1;
  const matchesCurrent = newestContent !== undefined && newestContent === currentText;
  const newestId = parseRevisionId(revisions[0].id);
  if (newestId !== null) {
    return matchesCurrent ? newestId : newestId + 1;
  }
  return matchesCurrent ? revisions.length : revisions.length + 1;
}
