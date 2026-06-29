import { useMemo } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import { lineDiff, hasChanges, type DiffRow } from "../utils/lineDiff";
import { formatLocalTimestamp } from "../utils/formatTimestamp";
import type { RevisionMeta } from "../api";

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

const rowStyles: Record<DiffRow["type"], { bg: string; sign: string; color: string }> = {
  equal: { bg: "transparent", sign: " ", color: "text.secondary" },
  add: { bg: "rgba(46, 160, 67, 0.18)", sign: "+", color: "success.main" },
  del: { bg: "rgba(248, 81, 73, 0.18)", sign: "-", color: "error.main" },
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
  const changed = hasChanges(rows);

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
          {revisions.map((r) => (
            <MenuItem key={r.id} value={r.id}>
              {r.id} · {formatLocalTimestamp(r.ts)}
            </MenuItem>
          ))}
        </Select>
        {!changed && (
          <Typography variant="caption" color="text.secondary">
            （変更なし）
          </Typography>
        )}
      </Box>

      {rows.map((row, idx) => {
        const s = rowStyles[row.type];
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
              {row.text === "" ? " " : row.text}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
