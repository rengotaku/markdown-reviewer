import { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ReplayIcon from "@mui/icons-material/Replay";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import type { CommentJSON } from "@/api";
import { renderCommentMarkdown } from "@/utils/commentMarkdown";
import { markdownBodySx } from "./markdownBodySx";

/** How many trailing messages stay visible when a thread is collapsed. The
 *  opening remark carries the ask and the tail carries whoever you are
 *  answering; the middle is the part nobody re-reads, so that is what folds. */
const KEEP_TAIL = 2;
/** Folding one message would trade a line of text for a line of button, so
 *  threads only collapse once at least this many would be hidden. */
const MIN_HIDDEN_TO_COLLAPSE = 2;

interface Message {
  author?: string;
  date?: string;
  body: string;
}

function messagesOf(comment: CommentJSON): Message[] {
  return [
    { author: comment.author, date: comment.date, body: comment.body },
    ...(comment.replies ?? []),
  ];
}

function MessageView({ m, testid }: { m: Message; testid: string }) {
  return (
    <Box data-testid={testid}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: "block", fontWeight: 500 }}
      >
        {m.author || "unknown"}
        {m.date ? ` · ${m.date}` : ""}
      </Typography>
      <Typography
        variant="body2"
        component="div"
        // XSS-safe: see commentMarkdown.ts (html:false + unmodified validateLink()).
        dangerouslySetInnerHTML={{ __html: renderCommentMarkdown(m.body) }}
        sx={[markdownBodySx, { mt: 0.5 }]}
      />
    </Box>
  );
}

interface Props {
  comment: CommentJSON;
  /** Heading / line context line shown above the thread, or null for global. */
  contextLabel: string | null;
  editDisabledReason: string | null;
  deleteDisabledReason: string | null;
  deleting: boolean;
  /** Ceiling in px, computed by the caller from the room around the anchor.
   *  Tall threads scroll inside the card rather than growing off-screen — the
   *  reply box has to stay reachable without scrolling the page. */
  maxHeight: number;
  /** Current reply draft. Lifted out so the caller can refuse to close the
   *  popover while unsent text is in it (#251). */
  draft: string;
  onDraftChange: (next: string) => void;
  onReply: (body: string) => void | Promise<void>;
  onResolveToggle: (next: "open" | "resolved") => void;
  onEdit: () => void;
  onDelete: () => void;
}

/** The thread a comment highlight opens on click (#251): every message, a
 *  reply box, and the actions that used to live in the hover bubble. Hover is
 *  now read-only (CommentHoverPreview), so this is the one place a comment is
 *  written to from the editor. */
export function CommentThreadPopover({
  comment,
  contextLabel,
  editDisabledReason,
  deleteDisabledReason,
  deleting,
  maxHeight,
  draft,
  onDraftChange,
  onReply,
  onResolveToggle,
  onEdit,
  onDelete,
}: Props) {
  // Remounted per comment by the caller's key, so folded-vs-expanded resets
  // with the thread rather than needing an effect to clear it.
  const [expanded, setExpanded] = useState(false);
  const messagesRef = useRef<HTMLDivElement | null>(null);

  // Land on the newest message: an expanded thread starts scrolled to the top,
  // which is the part the reader already agreed to fold away.
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [expanded, comment.replies?.length]);

  const messages = messagesOf(comment);
  const hidden = messages.length - 1 - KEEP_TAIL;
  const collapsed = !expanded && hidden >= MIN_HIDDEN_TO_COLLAPSE;
  const shown = collapsed
    ? [messages[0], ...messages.slice(-KEEP_TAIL)]
    : messages;
  const resolved = comment.status === "resolved";
  const canSend = draft.trim().length > 0;

  const send = () => {
    if (!canSend) return;
    void onReply(draft.trim());
  };

  return (
    <Paper
      elevation={6}
      data-testid="comment-thread-popover"
      sx={{
        width: 352,
        maxHeight,
        // The card is the frame; only the messages scroll (below), so the
        // reply box stays reachable however long the thread gets.
        overflow: "hidden",
        p: 1.5,
        display: "flex",
        flexDirection: "column",
        gap: 1.25,
      }}
    >
      {contextLabel && (
        <Typography
          variant="caption"
          color="text.disabled"
          data-testid="comment-thread-context"
        >
          {contextLabel}
        </Typography>
      )}

      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          gap: 1.25,
          minHeight: 0,
          overflow: "auto",
        }}
        data-testid="comment-thread-messages"
        ref={messagesRef}
      >
        <MessageView m={shown[0]} testid="comment-thread-message" />
        {collapsed && (
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            onClick={() => setExpanded(true)}
            data-testid="comment-thread-expand"
            sx={{ borderStyle: "dashed", color: "text.secondary" }}
          >
            返信 {hidden} 件を表示
          </Button>
        )}
        {shown.slice(1).map((m, i) => (
          <MessageView
            key={`${comment.id}-${collapsed ? "tail" : "all"}-${i}`}
            m={m}
            testid="comment-thread-message"
          />
        ))}
      </Box>

      <Box
        sx={{
          borderTop: "1px solid",
          borderColor: "divider",
          pt: 1.25,
          flexShrink: 0,
        }}
      >
        <TextField
          // Opening a thread is a request to reply, so the box takes focus.
          autoFocus
          multiline
          minRows={2}
          fullWidth
          size="small"
          placeholder="返信を書く…"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            // Enter alone stays a newline: these bodies are Markdown and
            // routinely span lines.
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send();
            }
          }}
          inputProps={{ "data-testid": "comment-thread-reply-input" }}
        />
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mt: 1 }}>
          <Button
            size="small"
            variant="contained"
            disabled={!canSend}
            onClick={send}
            data-testid="comment-thread-send"
          >
            返信
          </Button>
          <Button
            size="small"
            startIcon={
              resolved ? (
                <ReplayIcon fontSize="small" />
              ) : (
                <CheckCircleOutlineIcon fontSize="small" />
              )
            }
            onClick={() => onResolveToggle(resolved ? "open" : "resolved")}
            data-testid="comment-thread-resolve"
          >
            {resolved ? "未解決に戻す" : "解決する"}
          </Button>
          <Box sx={{ flexGrow: 1 }} />
          {/* A disabled MUI Button swallows hover events, so the tooltip
              carrying the reason needs a live wrapper. */}
          <Tooltip title={editDisabledReason ?? ""} placement="top">
            <span>
              <Button
                size="small"
                color="inherit"
                disabled={!!editDisabledReason}
                onClick={onEdit}
                data-testid="comment-thread-edit"
                sx={{ minWidth: 0, px: 0.75, color: "text.secondary" }}
              >
                <EditOutlinedIcon fontSize="small" />
              </Button>
            </span>
          </Tooltip>
          <Tooltip title={deleteDisabledReason ?? ""} placement="top">
            <span>
              <Button
                size="small"
                color="error"
                disabled={!!deleteDisabledReason || deleting}
                onClick={onDelete}
                data-testid="comment-thread-delete"
                sx={{ minWidth: 0, px: 0.75 }}
              >
                <DeleteOutlineIcon fontSize="small" />
              </Button>
            </span>
          </Tooltip>
        </Box>
        {canSend && (
          <Typography
            variant="caption"
            color="text.disabled"
            sx={{ display: "block", mt: 0.75 }}
            data-testid="comment-thread-draft-hint"
          >
            未送信の返信があります。Esc で破棄できます
          </Typography>
        )}
      </Box>
    </Paper>
  );
}
