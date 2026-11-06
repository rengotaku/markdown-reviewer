import { useEffect, useMemo, useRef, useState } from "react";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Chip from "@mui/material/Chip";
import Popover from "@mui/material/Popover";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import NotesIcon from "@mui/icons-material/Notes";
import type { SummaryItem } from "@/api";
import { renderCommentMarkdown } from "@/utils/commentMarkdown";
import {
  formatClock,
  formatSpan,
  referencedCommentIds,
  summaryTitle,
  unreadSummaryCount,
} from "@/utils/summaries";
import { CountBadge } from "./CountBadge";
import { markdownBodySx } from "./markdownBodySx";
import { pulseSx } from "./pulseSx";

interface Props {
  summaries: ReadonlyArray<SummaryItem>;
  lastSeenId: string | null;
  /** When the AI started replying to our send; null while it is not busy. */
  busySince: number | null;
  /** Ids of the comments that exist in the open file. */
  commentIds: ReadonlySet<string>;
  onOpen: () => void;
  onShowComment: (id: string) => void;
}

const NARROW = 420;
const WIDE = 600;

/** The AI's per-send work summaries (#374): a header button with an unread
 *  badge, and a two-step popover: the list, then one summary rendered as
 *  Markdown. Hidden until the file has at least one summary. */
export function AgentSummaryButton({
  summaries,
  lastSeenId,
  busySince,
  commentIds,
  onOpen,
  onShowComment,
}: Props) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  // Opening marks everything read, but the rows that were unread on opening
  // keep their chip until the popover closes.
  const [seenAtOpen, setSeenAtOpen] = useState<string | null>(null);
  const lastRow = useRef<HTMLElement | null>(null);
  const backRef = useRef<HTMLButtonElement | null>(null);

  const detail = useMemo(
    () => summaries.find((s) => s.id === detailId) ?? null,
    [summaries, detailId]
  );
  const refs = useMemo(
    () => (detail ? referencedCommentIds(detail.text, commentIds) : []),
    [detail, commentIds]
  );
  const html = useMemo(
    () => (detail ? renderCommentMarkdown(detail.text) : ""),
    [detail]
  );

  useEffect(() => {
    if (detail) backRef.current?.focus();
  }, [detail]);

  const empty = summaries.length === 0;
  const open = anchor !== null && !empty;
  const unread = open || empty ? 0 : unreadSummaryCount(summaries, lastSeenId);
  const sessionName = summaries[0]?.session_name;

  const close = () => {
    setAnchor(null);
    setDetailId(null);
  };
  const backToList = () => {
    setDetailId(null);
    requestAnimationFrame(() => lastRow.current?.focus());
  };

  return (
    <>
      <Tooltip title={empty ? "作業の要約（まだありません）" : "作業の要約"}>
        <Box component="span" sx={{ display: "inline-flex", flexShrink: 0 }}>
          <ButtonBase
            data-testid="agent-summary-button"
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-label={unread > 0 ? `作業の要約（未読 ${unread} 件）` : "作業の要約"}
            disabled={empty}
            onClick={(e) => {
              setSeenAtOpen(lastSeenId);
              setAnchor(e.currentTarget);
              onOpen();
            }}
            // #394: the same round 30×30 icon button as the rest of the
            // header (it was a 28px outlined square); unread shows as the
            // primary colour plus the badge, like the comment-pane button.
            sx={{
              p: "5px",
              borderRadius: "50%",
              color: unread > 0 ? "primary.main" : "action.active",
              bgcolor: open ? "action.selected" : "transparent",
              "&:hover": { bgcolor: open ? "action.selected" : "action.hover" },
              "&.Mui-disabled": { opacity: 0.4 },
              "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main" },
            }}
          >
            <NotesIcon sx={{ fontSize: 20 }} />
            {unread > 0 && <CountBadge count={unread} testId="agent-summary-badge" />}
          </ButtonBase>
        </Box>
      </Tooltip>
      <Popover
        open={open}
        anchorEl={anchor}
        onClose={(_, reason) => {
          if (reason === "escapeKeyDown" && detailId !== null) backToList();
          else close();
        }}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{
          paper: {
            role: "dialog",
            "aria-label": "作業の要約",
            sx: {
              width: detail ? WIDE : NARROW,
              maxWidth: "calc(100vw - 16px)",
              maxHeight: 560,
              display: "flex",
              flexDirection: "column",
              transition: "width .15s ease",
              "@media (prefers-reduced-motion: reduce)": { transition: "none" },
            },
          },
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            px: 1.75,
            py: 1.25,
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          <Typography variant="body2" sx={{ fontWeight: 500, flex: 1 }}>
            作業の要約
          </Typography>
          {sessionName && (
            <Typography variant="caption" color="text.secondary">
              送信先: {sessionName}
            </Typography>
          )}
        </Box>
        {detail ? (
          <Box data-testid="agent-summary-detail" sx={{ overflowY: "auto" }}>
            <Box
              sx={{
                position: "sticky",
                top: 0,
                bgcolor: "background.paper",
                display: "flex",
                alignItems: "center",
                gap: 1.25,
                px: 1.75,
                py: 1,
                borderBottom: 1,
                borderColor: "divider",
              }}
            >
              <ButtonBase
                ref={backRef}
                onClick={backToList}
                sx={{
                  typography: "body2",
                  color: "primary.main",
                  "&:focus-visible": {
                    outline: "2px solid",
                    outlineColor: "primary.main",
                  },
                }}
              >
                ← 一覧
              </ButtonBase>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ fontVariantNumeric: "tabular-nums" }}
              >
                {rowMeta(detail)}
              </Typography>
            </Box>
            <Box
              data-testid="agent-summary-body"
              sx={[
                {
                  px: 2,
                  py: 1.5,
                  fontSize: 14,
                  lineHeight: 1.7,
                  wordBreak: "break-word",
                },
                markdownBodySx,
                // #376: a summary's table keeps one line per cell and scrolls
                // sideways (markdownBodySx already makes the table scroll),
                // rather than wrapping each cell into a tall narrow column.
                { "& th, & td": { whiteSpace: "nowrap", wordBreak: "normal" } },
              ]}
              dangerouslySetInnerHTML={{ __html: html }}
            />
            {refs.length > 0 && (
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, px: 2, pb: 1.5 }}>
                {refs.map((id) => (
                  <Chip
                    key={id}
                    size="small"
                    label={id}
                    data-testid="agent-summary-comment-chip"
                    onClick={() => {
                      close();
                      onShowComment(id);
                    }}
                    sx={{ fontFamily: "monospace", fontSize: 11 }}
                  />
                ))}
              </Box>
            )}
          </Box>
        ) : (
          <Box data-testid="agent-summary-list" sx={{ overflowY: "auto" }}>
            {busySince !== null && (
              <Box
                data-testid="agent-summary-working"
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  px: 1.75,
                  py: 1.5,
                  color: "warning.main",
                  borderBottom: 1,
                  borderColor: "divider",
                  typography: "body2",
                }}
              >
                <Box
                  component="span"
                  sx={[
                    { width: 8, height: 8, borderRadius: "50%", bgcolor: "warning.main" },
                    pulseSx,
                  ]}
                />
                {formatClock(new Date(busySince).toISOString())}{" "}
                から処理中。終わると先頭に入ります
              </Box>
            )}
            {summaries.map((s) => {
              const isUnread =
                summaries.indexOf(s) < unreadSummaryCount(summaries, seenAtOpen);
              return (
                <ButtonBase
                  key={s.id}
                  data-testid="agent-summary-row"
                  onClick={(e) => {
                    lastRow.current = e.currentTarget;
                    setDetailId(s.id);
                  }}
                  sx={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    px: 1.75,
                    py: 1.25,
                    borderBottom: 1,
                    borderColor: "divider",
                    "&:hover": { bgcolor: "action.hover" },
                    "&:focus-visible": {
                      outline: "2px solid",
                      outlineColor: "primary.main",
                      outlineOffset: -2,
                    },
                  }}
                >
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 0.75,
                      typography: "caption",
                      color: "text.secondary",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {isUnread && (
                      <Chip
                        size="small"
                        color="primary"
                        label="未読"
                        data-testid="agent-summary-unread-chip"
                        sx={{ height: 16, fontSize: 10, fontWeight: 700 }}
                      />
                    )}
                    {rowMeta(s)}
                  </Box>
                  <Typography variant="body2" noWrap>
                    {summaryTitle(s.text) || "（本文なし）"}
                  </Typography>
                </ButtonBase>
              );
            })}
          </Box>
        )}
      </Popover>
    </>
  );
}

function rowMeta(s: SummaryItem): string {
  const span = formatSpan(s.sent_at, s.done_at);
  return `${formatClock(s.sent_at)} → ${formatClock(s.done_at)}${span ? `（${span}）` : ""}`;
}
