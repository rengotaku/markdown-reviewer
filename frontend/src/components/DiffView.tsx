import { useMemo } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Button from "@mui/material/Button";
import {
  lineDiff,
  hasChanges,
  intraLineSegments,
  countChanges,
  type DiffRow,
} from "../utils/lineDiff";
import { formatLocalTimestamp } from "../utils/formatTimestamp";
import type { RevisionMeta } from "../api";

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
}: DiffViewProps) {
  const rows = useMemo(() => lineDiff(oldText, newText), [oldText, newText]);
  const segsByRow = useMemo(() => intraLineSegments(rows), [rows]);
  const changed = hasChanges(rows);
  const { added, removed } = useMemo(() => countChanges(rows), [rows]);

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
      </Box>

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
