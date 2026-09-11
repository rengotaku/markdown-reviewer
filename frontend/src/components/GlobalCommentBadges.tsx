import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import PublicIcon from "@mui/icons-material/Public";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";

export type GlobalBadgeKind = "global" | "orphan";

interface Props {
  globalCount: number;
  orphanCount: number;
  onOpen: (kind: GlobalBadgeKind) => void;
}

/** One-line row of pressable badges at the top of the comment pane's list
 *  (#316). Global-scope and orphan comments have no live anchor to render
 *  beside in the document body, so instead of permanently occupying space
 *  above the editor (the old DocumentTopComments, #309) they collapse to a
 *  count here — click one to see the full threads in GlobalCommentsDialog.
 *  A badge with a zero count doesn't render, and if both counts are zero
 *  this component renders nothing at all. */
export function GlobalCommentBadges({ globalCount, orphanCount, onOpen }: Props) {
  if (globalCount === 0 && orphanCount === 0) return null;

  return (
    <Box
      sx={{
        display: "flex",
        gap: 0.75,
        px: 1.5,
        py: 0.75,
        flexShrink: 0,
        borderBottom: "1px solid",
        borderColor: "divider",
      }}
      data-testid="global-comment-badges"
    >
      {globalCount > 0 && (
        <Chip
          icon={<PublicIcon fontSize="small" />}
          label={`全体 ${globalCount}`}
          size="small"
          color="info"
          onClick={() => onOpen("global")}
          data-testid="global-comment-badge"
          aria-label={`全体コメント ${globalCount} 件`}
          sx={{ cursor: "pointer" }}
        />
      )}
      {orphanCount > 0 && (
        <Chip
          icon={<WarningAmberIcon fontSize="small" />}
          // The warning mark comes from the Chip's icon — repeating it in
          // the label showed two of them side by side (#318).
          label={`位置不明 ${orphanCount}`}
          size="small"
          color="warning"
          variant="outlined"
          onClick={() => onOpen("orphan")}
          data-testid="orphan-comment-badge"
          aria-label={`位置不明コメント ${orphanCount} 件`}
          sx={{ cursor: "pointer" }}
        />
      )}
    </Box>
  );
}
