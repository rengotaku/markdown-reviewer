import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import CommentIcon from "@mui/icons-material/Comment";
import PublicIcon from "@mui/icons-material/Public";
import type { CommentJSON } from "@/api";

/**
 * CommentRail is what the comment pane collapses to (#276): a 40px strip that
 * keeps the two things a reader loses when the pane is closed — how many
 * comments the file has, and the ability to say something about the file as a
 * whole.
 *
 * The counts mirror the pane's status filter (すべて / 未解決 / 解決済) over
 * every comment on the file, anchored and file-wide alike, so opening the pane
 * never changes the numbers. They are text, not buttons: the rail is 40px and
 * a control that only restates what the pane already offers is not worth the
 * target area (see the issue's "やらないこと").
 */

/** Labels are one character each to fit the rail; the full name goes to
 *  assistive tech via aria-label. */
const COUNTS: { key: string; short: string; label: string }[] = [
  { key: "all", short: "全", label: "すべて" },
  { key: "open", short: "未", label: "未解決" },
  { key: "resolved", short: "済", label: "解決済" },
];

interface Props {
  comments: CommentJSON[];
  /** False for a file that is not under review yet — nothing to count. */
  reviewActive: boolean;
  onOpen: () => void;
  /** Opens the file-wide comment composer anchored at the button. */
  onAddGlobal: (rect: DOMRect) => void;
}

export function CommentRail({
  comments,
  reviewActive,
  onOpen,
  onAddGlobal,
}: Props) {
  const openCount = comments.filter((c) => c.status === "open").length;
  const counts: Record<string, number> = {
    all: comments.length,
    open: openCount,
    resolved: comments.length - openCount,
  };
  // Three zeroes carry no information, and neither does a count on a file
  // nobody has reviewed yet.
  const showCounts = reviewActive && comments.length > 0;

  return (
    <Box
      component="aside"
      sx={{
        width: 40,
        flexShrink: 0,
        borderLeft: "1px solid",
        borderColor: "divider",
        bgcolor: "background.paper",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 0.5,
        pt: 0.75,
      }}
      data-testid="comment-rail"
    >
      <Tooltip title="コメントペインを開く" placement="left">
        <IconButton
          size="small"
          onClick={onOpen}
          aria-label="open comment pane"
          data-testid="editor-toggle-comments"
        >
          <CommentIcon fontSize="small" />
        </IconButton>
      </Tooltip>

      <Tooltip
        title="ファイル全体に向けたコメントを追加（選択不要・未取り込みなら自動で取り込む）"
        placement="left"
      >
        <IconButton
          size="small"
          color="primary"
          onClick={(e) => onAddGlobal(e.currentTarget.getBoundingClientRect())}
          aria-label="ファイル全体にコメントを追加"
          data-testid="rail-add-global-comment"
        >
          <PublicIcon fontSize="small" />
        </IconButton>
      </Tooltip>

      {showCounts && (
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 0.75,
            mt: 0.5,
          }}
          data-testid="comment-rail-counts"
        >
          {COUNTS.map(({ key, short, label }) => (
            <Box
              key={key}
              aria-label={`${label} ${counts[key]}件`}
              data-testid={`comment-rail-count-${key}`}
              sx={{ textAlign: "center", lineHeight: 1.1 }}
            >
              <Typography
                variant="caption"
                component="div"
                color="text.secondary"
                sx={{ fontSize: "0.65rem", lineHeight: 1.1 }}
                aria-hidden
              >
                {short}
              </Typography>
              <Typography
                variant="caption"
                component="div"
                // Unresolved is the number a reviewer acts on, so it keeps the
                // body colour while the other two stay secondary.
                color={
                  key === "open" && counts[key] > 0
                    ? "text.primary"
                    : "text.secondary"
                }
                sx={{
                  fontSize: "0.75rem",
                  fontWeight: key === "open" && counts[key] > 0 ? 600 : 400,
                  lineHeight: 1.1,
                }}
                aria-hidden
              >
                {counts[key]}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
