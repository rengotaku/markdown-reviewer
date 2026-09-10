import { useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { CommentJSON } from "@/api";
import { buildCommentDeepLink } from "@/utils/deeplink";
import { useToast } from "@/hooks/useToast";
import { CommentRow, CommentDetailDialog } from "./CommentSidePane";

interface Props {
  root?: string;
  filePath?: string;
  /** Full comment list for the active file — filtered down to global-scope
   *  and orphan comments here (the ones with no live anchor to render
   *  beside in the document body). */
  comments: ReadonlyArray<CommentJSON>;
  onDelete: (id: string) => void;
  onResolveToggle: (id: string, next: "open" | "resolved") => void;
  onReply: (id: string, body: string) => void;
  onEdit: (id: string, body: string) => void;
  onEditReply: (id: string, index: number, body: string) => void;
  onDeleteReply: (id: string, index: number) => void;
}

/** Renders the file's global-scope and orphan comments at the top of the
 *  document body (#309), sharing the same threaded-row UI (CommentRow) the
 *  side pane's old pinned section used — reply / resolve / edit / delete /
 *  copy-link / open-detail all work the same way here. Anchored comments
 *  never appear here: they stay in the paragraph-aligned rail. Adding a new
 *  global comment still happens via the pane header's always-visible globe
 *  icon (#309's core ask — no scrolling required to add one), not from
 *  this component. */
export function DocumentTopComments({
  root,
  filePath,
  comments,
  onDelete,
  onResolveToggle,
  onReply,
  onEdit,
  onEditReply,
  onDeleteReply,
}: Props) {
  const pinned = useMemo(
    () => comments.filter((c) => c.scope === "global" || c.orphan),
    [comments]
  );
  const [detailId, setDetailId] = useState<string | null>(null);
  const detailComment = useMemo(
    () => pinned.find((c) => c.id === detailId) ?? null,
    [pinned, detailId]
  );

  const canCopyLink = Boolean(root && filePath);
  const handleCopyLink = async (id: string) => {
    if (!root || !filePath) return;
    const url = buildCommentDeepLink(window.location.origin, root, filePath, id);
    try {
      await navigator.clipboard.writeText(url);
      useToast.getState().show("リンクをコピーしました", "success");
    } catch {
      useToast.getState().show("リンクのコピーに失敗しました", "error");
    }
  };

  if (pinned.length === 0) return null;

  return (
    <Box data-testid="document-top-comments" className="document-top-comments" sx={{ mb: 2 }}>
      <Typography
        variant="caption"
        sx={{ display: "block", px: 0.5, mb: 0.5, letterSpacing: ".04em", color: "text.secondary" }}
      >
        全体・位置不明 {pinned.length}
      </Typography>
      <Box
        sx={{
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 1,
          overflow: "hidden",
        }}
      >
        {pinned.map((c) => (
          <CommentRow
            key={c.id}
            comment={c}
            onDelete={onDelete}
            onResolveToggle={onResolveToggle}
            onReply={onReply}
            onEdit={onEdit}
            onEditReply={onEditReply}
            onDeleteReply={onDeleteReply}
            // No live anchor exists for a global/orphan comment, so there is
            // nothing in the editor to jump to.
            onJump={() => {}}
            onOpenDetail={setDetailId}
            onCopyLink={handleCopyLink}
            canCopyLink={canCopyLink}
          />
        ))}
      </Box>

      <CommentDetailDialog
        comment={detailComment}
        onClose={() => setDetailId(null)}
        onDelete={(id) => {
          onDelete(id);
          setDetailId(null);
        }}
        onResolveToggle={onResolveToggle}
        onReply={onReply}
        onEdit={onEdit}
        onEditReply={onEditReply}
        onDeleteReply={onDeleteReply}
        onJump={() => setDetailId(null)}
        onCopyLink={handleCopyLink}
        canCopyLink={canCopyLink}
      />
    </Box>
  );
}
