import { useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";
import PublicIcon from "@mui/icons-material/Public";
import type { CommentJSON } from "@/api";
import { CommentRow } from "./CommentSidePane";
import type { GlobalBadgeKind } from "./GlobalCommentBadges";

interface Props {
  open: boolean;
  /** Which tab to show first — determined by which badge was pressed. */
  initialTab: GlobalBadgeKind;
  globalComments: ReadonlyArray<CommentJSON>;
  orphanComments: ReadonlyArray<CommentJSON>;
  onClose: () => void;
  onDelete: (id: string) => void;
  onResolveToggle: (id: string, next: "open" | "resolved") => void;
  onReply: (id: string, body: string) => void;
  onEdit: (id: string, body: string) => void;
  onEditReply: (id: string, index: number, body: string) => void;
  onDeleteReply: (id: string, index: number) => void;
  onCopyLink: (id: string) => void;
  canCopyLink?: boolean;
  /** Same handler the pane header's globe icon uses (#252): opens the
   *  composer beside the trigger button's rect. */
  onAddGlobal: (anchor: DOMRect) => void;
}

/** Centered modal opened from GlobalCommentBadges (#316). A badge only has
 *  room for a count, so the full threads — reply / edit / resolve / delete /
 *  copy-link, via the same CommentRow the old pinned section used — live
 *  here. Tabs only appear when both a global and an orphan comment exist;
 *  otherwise the single list renders without them. */
export function GlobalCommentsDialog({
  open,
  initialTab,
  globalComments,
  orphanComments,
  onClose,
  onDelete,
  onResolveToggle,
  onReply,
  onEdit,
  onEditReply,
  onDeleteReply,
  onCopyLink,
  canCopyLink = true,
  onAddGlobal,
}: Props) {
  const [tab, setTab] = useState<GlobalBadgeKind>(initialTab);
  // Re-sync whenever the dialog is (re)opened for a possibly different
  // badge — React state persists across `open` toggles since this
  // component never unmounts between opens. Derived during render (the
  // same pattern CommentDetailDialog uses for its own reset-on-reopen
  // state) rather than in a useEffect, which would call setState after an
  // extra render.
  const [lastOpen, setLastOpen] = useState(open);
  if (open && !lastOpen) {
    setLastOpen(open);
    setTab(initialTab);
  } else if (open !== lastOpen) {
    setLastOpen(open);
  }

  const showTabs = globalComments.length > 0 && orphanComments.length > 0;
  const activeTab: GlobalBadgeKind = showTabs
    ? tab
    : globalComments.length > 0
      ? "global"
      : "orphan";
  const list = activeTab === "global" ? globalComments : orphanComments;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      data-testid="global-comments-dialog"
    >
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, pr: 1 }}>
        <Box sx={{ flexGrow: 1 }}>
          {showTabs ? (
            <Tabs
              value={tab}
              onChange={(_, v: GlobalBadgeKind) => setTab(v)}
              aria-label="全体・位置不明コメントの切り替え"
              sx={{ minHeight: 0 }}
            >
              <Tab
                value="global"
                label={`全体 ${globalComments.length}`}
                data-testid="global-comments-tab-global"
                sx={{ minHeight: 0 }}
              />
              <Tab
                value="orphan"
                label={`位置不明 ${orphanComments.length}`}
                data-testid="global-comments-tab-orphan"
                sx={{ minHeight: 0 }}
              />
            </Tabs>
          ) : (
            <Typography variant="subtitle1">
              {activeTab === "global"
                ? `全体コメント ${globalComments.length}`
                : `位置不明コメント ${orphanComments.length}`}
            </Typography>
          )}
        </Box>
        <IconButton onClick={onClose} aria-label="閉じる" data-testid="global-comments-dialog-close">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        {list.map((c) => (
          <CommentRow
            key={c.id}
            comment={c}
            onDelete={onDelete}
            onResolveToggle={onResolveToggle}
            onReply={onReply}
            onEdit={onEdit}
            onEditReply={onEditReply}
            onDeleteReply={onDeleteReply}
            // Global/orphan comments have no live anchor in the document to
            // jump to.
            onJump={() => {}}
            // This dialog already is the centered view CommentDetailDialog
            // would open, so the row hides that button rather than offering
            // one that stacks a second modal (or does nothing when pressed).
            showDetail={false}
            onOpenDetail={() => {}}
            onCopyLink={onCopyLink}
            canCopyLink={canCopyLink}
          />
        ))}
      </DialogContent>
      <DialogActions>
        <Button
          startIcon={<PublicIcon fontSize="small" />}
          onClick={(e) => {
            onAddGlobal(e.currentTarget.getBoundingClientRect());
            onClose();
          }}
          data-testid="global-comments-dialog-add"
        >
          全体コメントを追加
        </Button>
      </DialogActions>
    </Dialog>
  );
}
