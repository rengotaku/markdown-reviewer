import { useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogActions from "@mui/material/DialogActions";
import {
  lineDiff,
  hasChanges,
  intraLineSegments,
  countChanges,
  type DiffRow,
} from "../utils/lineDiff";
import { formatLocalTimestamp } from "../utils/formatTimestamp";
import type { RevisionMeta } from "../api";
import { BAR_HEIGHT } from "@/theme/dimensions";

/** `"external"` → `"外部編集"`、それ以外はそのまま返す。 */
function authorLabel(author: string): string {
  return author === "external" ? "外部編集" : author;
}

interface DiffViewProps {
  /** Older revision content (left/baseline side). */
  oldText: string;
  /** Newer / latest content (right side). */
  newText: string;
  /** Available revisions for the picker (newest first). */
  revisions: RevisionMeta[];
  /** Currently selected baseline revision id. */
  selectedRevId: string | null;
  /** Called when the user picks a different baseline revision. */
  onSelectRevision: (id: string) => void;
  /**
   * Restores the selected baseline revision onto the canonical file (#282).
   * DiffView never calls the API itself — restoring rewrites the document
   * wholesale, which is squarely the managed-review write path the editor
   * page (and its autosave/dirty bookkeeping) owns. Omit to hide the button
   * entirely (e.g. read-only surfaces that only ever want the viewer).
   */
  onRestoreRevision?: (id: string) => Promise<void> | void;
  /**
   * True while a restore triggered from this view is in flight. Disables the
   * restore button so a slow request can't be fired twice.
   */
  restoring?: boolean;
}

const rowStyles: Record<
  DiffRow["type"],
  { bg: string; sign: string; color: string; charBg: string }
> = {
  equal: { bg: "transparent", sign: " ", color: "text.secondary", charBg: "transparent" },
  // charBg is the stronger tint applied to the specific characters that changed
  // within an edited line, on top of the whole-line bg.
  add: { bg: "rgba(46, 160, 67, 0.18)", sign: "+", color: "success.main", charBg: "rgba(46, 160, 67, 0.4)" },
  del: { bg: "rgba(248, 81, 73, 0.18)", sign: "-", color: "error.main", charBg: "rgba(248, 81, 73, 0.4)" },
};

/**
 * DiffView renders a read-only, unified line-level diff. It never mutates the
 * editor: the managed-review model keeps prose edits on the AI/API channel, so
 * this is purely a viewer for "latest 正典 ⇔ past revision".
 *
 * The revision picker lives in this component's own sticky header (rather than
 * the editor toolbar) so toggling diff mode never reflows the toolbar buttons.
 */
export function DiffView({
  oldText,
  newText,
  revisions,
  selectedRevId,
  onSelectRevision,
  onRestoreRevision,
  restoring = false,
}: DiffViewProps) {
  const rows = useMemo(() => lineDiff(oldText, newText), [oldText, newText]);
  const segsByRow = useMemo(() => intraLineSegments(rows), [rows]);
  const changed = hasChanges(rows);
  const { added, removed } = useMemo(() => countChanges(rows), [rows]);
  // Confirming inline (rather than delegating to the app-wide useConfirm
  // queue) keeps this component a drop-in, self-contained viewer: it already
  // owns "purely a viewer" semantics in its doc comment, and restoring is the
  // one action serious enough to need a guard rail before it ever reaches
  // the onRestoreRevision callback.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const selectedRevision = revisions.find((r) => r.id === selectedRevId) ?? null;

  const handleConfirmRestore = () => {
    setConfirmOpen(false);
    if (selectedRevId) void onRestoreRevision?.(selectedRevId);
  };

  return (
    <Box
      data-testid="diff-view"
      sx={{
        height: "100%",
        overflow: "auto",
        bgcolor: "background.default",
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 13,
        lineHeight: 1.6,
      }}
    >
      <Box
        sx={{
          px: 2,
          py: 1,
          // minHeight aligns the diff header with BAR_HEIGHT (37px); expands
          // naturally if the revision picker wraps (#90).
          minHeight: BAR_HEIGHT,
          boxSizing: "border-box",
          position: "sticky",
          top: 0,
          bgcolor: "background.paper",
          borderBottom: "1px solid",
          borderColor: "divider",
          zIndex: 1,
          display: "flex",
          alignItems: "center",
          gap: 1.5,
        }}
      >
        {/* クイック選択ボタン */}
        {revisions.length > 0 && (
          <Button
            size="small"
            variant="text"
            data-testid="diff-btn-latest-round"
            disabled={selectedRevId === revisions[0].id}
            onClick={() => onSelectRevision(revisions[0].id)}
            sx={{ flexShrink: 0, minWidth: "auto" }}
          >
            前ラウンド
          </Button>
        )}
        {revisions.length > 1 && (
          <Button
            size="small"
            variant="text"
            data-testid="diff-btn-first"
            disabled={selectedRevId === revisions[revisions.length - 1].id}
            onClick={() => onSelectRevision(revisions[revisions.length - 1].id)}
            sx={{ flexShrink: 0, minWidth: "auto" }}
          >
            初版
          </Button>
        )}

        {/* revision picker: label を id · 日時 · author に拡張 */}
        <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
          差分: 最新 ⇔
        </Typography>
        <Select
          size="small"
          value={selectedRevId ?? ""}
          onChange={(e) => onSelectRevision(e.target.value as string)}
          data-testid="diff-revision-picker"
          sx={{ minWidth: 190, "& .MuiSelect-select": { py: 0.5, fontSize: 13 } }}
        >
          {revisions.map((r) => {
            const isExternal = r.author === "external";
            return (
              <MenuItem key={r.id} value={r.id}>
                {r.id} · {formatLocalTimestamp(r.ts)} ·{" "}
                <Box
                  component="span"
                  sx={{ color: isExternal ? "warning.main" : "text.primary", ml: 0.5 }}
                >
                  {authorLabel(r.author)}
                </Box>
              </MenuItem>
            );
          })}
        </Select>

        {/* 選択中 baseline の author 表示 */}
        {selectedRevId && (() => {
          const sel = revisions.find((r) => r.id === selectedRevId);
          if (!sel) return null;
          return (
            <Typography
              variant="caption"
              color="text.secondary"
              data-testid="diff-selected-author"
              sx={{ flexShrink: 0 }}
            >
              ({authorLabel(sel.author)})
            </Typography>
          );
        })()}

        {changed && (
          <Typography
            variant="caption"
            data-testid="diff-change-stats"
            sx={{ flexShrink: 0 }}
          >
            <Box component="span" sx={{ color: "success.main" }}>+{added}</Box>
            {" "}
            <Box component="span" sx={{ color: "error.main" }}>-{removed}</Box>
          </Typography>
        )}
        {!changed && (
          <Typography variant="caption" color="text.secondary">
            このバージョンと現在の内容に差分はありません
          </Typography>
        )}

        {onRestoreRevision && (
          <Button
            size="small"
            variant="outlined"
            color="warning"
            data-testid="diff-btn-restore"
            disabled={!selectedRevId || restoring}
            onClick={() => setConfirmOpen(true)}
            sx={{ flexShrink: 0, minWidth: "auto", ml: "auto" }}
          >
            この版に戻す
          </Button>
        )}
      </Box>

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        aria-labelledby="diff-restore-dialog-title"
        data-testid="diff-restore-dialog"
      >
        <DialogTitle id="diff-restore-dialog-title">この版に戻しますか？</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {selectedRevision ? (
              <>
                現在の本文を、選択中のリビジョン {selectedRevision.id} ・{" "}
                {formatLocalTimestamp(selectedRevision.ts)} ・{" "}
                {authorLabel(selectedRevision.author)} の内容へ書き戻します。
                <br />
                戻す前の内容は新しいリビジョンとして残ります。
              </>
            ) : (
              "戻す版が選択されていません。"
            )}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>キャンセル</Button>
          <Button
            onClick={handleConfirmRestore}
            variant="contained"
            color="warning"
            autoFocus
            data-testid="diff-restore-confirm"
          >
            戻す
          </Button>
        </DialogActions>
      </Dialog>

      {rows.map((row, idx) => {
        const s = rowStyles[row.type];
        const segs = segsByRow.get(idx);
        return (
          <Box
            key={idx}
            data-diff-type={row.type}
            sx={{
              display: "flex",
              bgcolor: s.bg,
              px: 1,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            <Box
              component="span"
              sx={{
                width: 16,
                flexShrink: 0,
                userSelect: "none",
                color: s.color,
                textAlign: "center",
              }}
            >
              {s.sign}
            </Box>
            <Box component="span" sx={{ flex: 1 }}>
              {segs
                ? segs.map((seg, sidx) =>
                    seg.changed ? (
                      <Box
                        key={sidx}
                        component="span"
                        sx={{ fontWeight: 700, bgcolor: s.charBg, borderRadius: "2px" }}
                      >
                        {seg.text}
                      </Box>
                    ) : (
                      <span key={sidx}>{seg.text}</span>
                    )
                  )
                : row.text === ""
                  ? " "
                  : row.text}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
