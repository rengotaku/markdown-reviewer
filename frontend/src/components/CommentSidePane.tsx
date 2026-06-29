import { useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import CommentsDisabledIcon from "@mui/icons-material/CommentsDisabled";
import AddCommentIcon from "@mui/icons-material/AddComment";
import PublicIcon from "@mui/icons-material/Public";
import HubIcon from "@mui/icons-material/Hub";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ReplayIcon from "@mui/icons-material/Replay";
import ReplyIcon from "@mui/icons-material/Reply";
import type { CommentJSON } from "@/api";

const SCOPE_BADGE: Record<string, { label: string; color: string }> = {
  inline: { label: "inline", color: "#fff8c5" },
  block: { label: "block", color: "#fff8c5" },
  cross_section: { label: "横断", color: "#fef3c7" },
  global: { label: "全体", color: "#e0f2fe" },
};

interface Props {
  comments: ReadonlyArray<CommentJSON>;
  /** The active file is under review (draft files cannot take comments). */
  reviewActive: boolean;
  onClose?: () => void;
  /** Whether the current editor selection can take an anchored comment. */
  canAddComment: boolean;
  onAddComment: () => void;
  onAddGlobal: () => void;
  onAddCrossSection: () => void;
  onDelete: (id: string) => void;
  onResolveToggle: (id: string, next: "open" | "resolved") => void;
  onReply: (id: string, body: string) => void;
  onEdit: (id: string, body: string) => void;
  /** Scroll to + flash the comment's highlight in the editor. */
  onJump: (id: string) => void;
}

/** The text/section a comment was originally anchored to, from its stored
 *  anchor(s). Used to show what an orphaned comment pointed at, even after the
 *  canonical body changed and the live position can no longer be resolved. */
function originalTarget(c: CommentJSON): string {
  const fmt = (heading: string[], snippet: string) => {
    const head = heading[heading.length - 1];
    return head ? `${head} › ${snippet}` : snippet;
  };
  if (c.anchors && c.anchors.length > 0) {
    return c.anchors.map((a) => fmt(a.heading_path, a.snippet)).join(" / ");
  }
  if (c.anchor) return fmt(c.anchor.heading_path, c.anchor.snippet);
  return "";
}

function contextLabel(c: CommentJSON): string | null {
  if (c.scope === "global") return null;
  if (c.orphan) {
    const orig = originalTarget(c);
    return orig
      ? `${orig}（現在の本文には見つかりません）`
      : "位置不明 (orphan)";
  }
  if (c.anchors && c.anchors.length > 0) {
    return c.anchors
      .map((a) => a.heading_path[a.heading_path.length - 1] ?? a.snippet)
      .filter(Boolean)
      .join(" ・ ");
  }
  if (c.context) {
    const head = c.context.heading_path[c.context.heading_path.length - 1];
    const [s, e] = c.context.line_range;
    const lines = s === e ? `L${s}` : `L${s}–${e}`;
    return head ? `${head} (${lines})` : lines;
  }
  if (c.anchor) return c.anchor.snippet;
  return null;
}

type StatusFilter = "all" | "open" | "resolved";

export function CommentSidePane({
  comments,
  reviewActive,
  onClose,
  canAddComment,
  onAddComment,
  onAddGlobal,
  onAddCrossSection,
  onDelete,
  onResolveToggle,
  onReply,
  onEdit,
  onJump,
}: Props) {
  const [filter, setFilter] = useState<StatusFilter>("all");
  const openCount = useMemo(
    () => comments.filter((c) => c.status === "open").length,
    [comments]
  );
  const resolvedCount = comments.length - openCount;
  const visible = useMemo(
    () =>
      filter === "all"
        ? comments
        : comments.filter((c) => c.status === filter),
    [comments, filter]
  );

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
      data-testid="comment-side-pane"
    >
      <Box
        sx={{
          pl: 2,
          pr: 0.5,
          py: 1,
          minHeight: 48,
          boxSizing: "border-box",
          borderBottom: "1px solid",
          borderColor: "divider",
          display: "flex",
          alignItems: "center",
          gap: 1,
        }}
      >
        <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
          Comments ({openCount}/{comments.length})
        </Typography>
        {onClose && (
          <Tooltip title="コメントペインを閉じる">
            <IconButton
              size="small"
              onClick={onClose}
              aria-label="close comment pane"
              data-testid="comment-pane-close"
            >
              <CommentsDisabledIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      <Box
        sx={{
          px: 1.5,
          py: 0.75,
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <ToggleButtonGroup
          value={filter}
          exclusive
          size="small"
          fullWidth
          onChange={(_, v) => {
            if (v !== null) setFilter(v as StatusFilter);
          }}
          aria-label="コメントの表示フィルタ"
          data-testid="comment-status-filter"
        >
          <ToggleButton value="all" sx={{ textTransform: "none", py: 0.25 }} data-testid="comment-filter-all">
            すべて ({comments.length})
          </ToggleButton>
          <ToggleButton value="open" sx={{ textTransform: "none", py: 0.25 }} data-testid="comment-filter-open">
            未解決 ({openCount})
          </ToggleButton>
          <ToggleButton value="resolved" sx={{ textTransform: "none", py: 0.25 }} data-testid="comment-filter-resolved">
            解決済 ({resolvedCount})
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      <Box
        sx={{
          px: 1.5,
          py: 1,
          borderBottom: "1px solid",
          borderColor: "divider",
          display: "flex",
          flexWrap: "wrap",
          gap: 0.75,
        }}
        data-testid="comment-add-toolbar"
      >
        <Tooltip title="選択範囲にコメントを追加">
          <span>
            <Button
              variant="outlined"
              size="small"
              startIcon={<AddCommentIcon />}
              disabled={!reviewActive || !canAddComment}
              onClick={onAddComment}
              data-testid="editor-add-comment"
            >
              コメント
            </Button>
          </span>
        </Tooltip>
        <Tooltip title="ファイル全体に向けたコメントを追加（選択不要）">
          <span>
            <Button
              variant="outlined"
              size="small"
              startIcon={<PublicIcon />}
              disabled={!reviewActive}
              onClick={onAddGlobal}
              data-testid="editor-add-global-comment"
            >
              全体
            </Button>
          </span>
        </Tooltip>
        <Tooltip title="複数の見出しに紐付ける横断コメントを追加">
          <span>
            <Button
              variant="outlined"
              size="small"
              startIcon={<HubIcon />}
              disabled={!reviewActive}
              onClick={onAddCrossSection}
              data-testid="editor-add-cross-section-comment"
            >
              横断
            </Button>
          </span>
        </Tooltip>
      </Box>

      <Box sx={{ flex: 1, overflow: "auto" }}>
        {!reviewActive ? (
          <Box sx={{ p: 2 }}>
            <Typography variant="body2" color="text.secondary">
              このファイルはまだレビュー対象ではありません。ヘッダーの「取り込む」でレビューを開始するとコメントを追加できます。
            </Typography>
          </Box>
        ) : comments.length === 0 ? (
          <Box sx={{ p: 2 }}>
            <Typography variant="body2" color="text.secondary">
              コメントはまだありません。テキストを選択して「コメント」を押すと追加できます。
            </Typography>
          </Box>
        ) : visible.length === 0 ? (
          <Box sx={{ p: 2 }}>
            <Typography variant="body2" color="text.secondary">
              {filter === "open"
                ? "未解決のコメントはありません。"
                : "解決済みのコメントはありません。"}
            </Typography>
          </Box>
        ) : (
          visible.map((c) => (
            <CommentRow
              key={c.id}
              comment={c}
              onDelete={onDelete}
              onResolveToggle={onResolveToggle}
              onReply={onReply}
              onEdit={onEdit}
              onJump={onJump}
            />
          ))
        )}
      </Box>
    </Box>
  );
}

interface RowProps {
  comment: CommentJSON;
  onDelete: (id: string) => void;
  onResolveToggle: (id: string, next: "open" | "resolved") => void;
  onReply: (id: string, body: string) => void;
  onEdit: (id: string, body: string) => void;
  onJump: (id: string) => void;
}

function CommentRow({
  comment: c,
  onDelete,
  onResolveToggle,
  onReply,
  onEdit,
  onJump,
}: RowProps) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editBody, setEditBody] = useState(c.body);
  const ctx = contextLabel(c);
  const badge = SCOPE_BADGE[c.scope];
  const resolved = c.status === "resolved";
  const canJump = c.scope !== "global" && !c.orphan;

  const submitReply = () => {
    const body = replyBody.trim();
    if (!body) return;
    onReply(c.id, body);
    setReplyBody("");
    setReplyOpen(false);
  };

  const startEdit = () => {
    setEditBody(c.body);
    setEditOpen(true);
  };

  const submitEdit = () => {
    const body = editBody.trim();
    if (!body || body === c.body) {
      setEditOpen(false);
      return;
    }
    onEdit(c.id, body);
    setEditOpen(false);
  };

  return (
    <Box
      data-testid="comment-item"
      data-comment-id={c.id}
      data-comment-status={c.status}
      sx={{
        p: 1.5,
        borderBottom: "1px solid",
        borderColor: "divider",
        opacity: resolved ? 0.6 : 1,
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
        {badge && (
          <Chip
            label={badge.label}
            size="small"
            sx={{
              height: 18,
              fontSize: "0.65rem",
              bgcolor: badge.color,
              "& .MuiChip-label": { px: 0.75 },
            }}
            data-testid={`comment-scope-${c.scope}`}
          />
        )}
        {resolved && (
          <Chip
            label="resolved"
            size="small"
            color="success"
            variant="outlined"
            sx={{ height: 18, fontSize: "0.65rem", "& .MuiChip-label": { px: 0.75 } }}
            data-testid="comment-status-resolved"
          />
        )}
        {c.orphan && (
          <Chip
            label="orphan"
            size="small"
            color="warning"
            variant="outlined"
            sx={{ height: 18, fontSize: "0.65rem", "& .MuiChip-label": { px: 0.75 } }}
            data-testid="comment-orphan"
          />
        )}
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ flexGrow: 1, textAlign: "right" }}
        >
          {c.author || "?"} {c.date ? `· ${c.date}` : ""}
        </Typography>
      </Box>

      {ctx && (
        <Typography
          variant="caption"
          color="text.secondary"
          onClick={canJump ? () => onJump(c.id) : undefined}
          data-testid={`comment-context-${c.id}`}
          sx={{
            display: "block",
            fontStyle: "italic",
            wordBreak: "break-word",
            cursor: canJump ? "pointer" : "default",
            "&:hover": canJump ? { textDecoration: "underline" } : undefined,
          }}
        >
          対象: {ctx}
        </Typography>
      )}

      {editOpen && !resolved ? (
        <Box sx={{ mt: 0.5 }}>
          <TextField
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            multiline
            minRows={2}
            fullWidth
            size="small"
            autoFocus
            inputProps={{ "data-testid": "comment-edit-input" }}
          />
          <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 0.5, mt: 0.5 }}>
            <Button size="small" onClick={() => setEditOpen(false)}>
              キャンセル
            </Button>
            <Button
              size="small"
              variant="contained"
              onClick={submitEdit}
              disabled={!editBody.trim()}
              data-testid="comment-edit-submit"
            >
              更新
            </Button>
          </Box>
        </Box>
      ) : (
        <Typography
          variant="body2"
          sx={{ mt: 0.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}
        >
          {c.body}
        </Typography>
      )}

      {c.replies && c.replies.length > 0 && (
        <Box sx={{ mt: 1, pl: 1, borderLeft: "2px solid", borderColor: "divider" }}>
          {c.replies.map((r, i) => (
            <Box key={i} sx={{ mb: 0.5 }} data-testid="comment-reply">
              <Typography variant="caption" color="text.secondary">
                {r.author || "?"} {r.date ? `· ${r.date}` : ""}
              </Typography>
              <Typography
                variant="body2"
                sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
              >
                {r.body}
              </Typography>
            </Box>
          ))}
        </Box>
      )}

      {replyOpen && !resolved && (
        <Box sx={{ mt: 1 }}>
          <TextField
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            placeholder="返信を入力"
            multiline
            minRows={2}
            fullWidth
            size="small"
            autoFocus
            inputProps={{ "data-testid": "comment-reply-input" }}
          />
          <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 0.5, mt: 0.5 }}>
            <Button size="small" onClick={() => setReplyOpen(false)}>
              キャンセル
            </Button>
            <Button
              size="small"
              variant="contained"
              onClick={submitReply}
              disabled={!replyBody.trim()}
              data-testid="comment-reply-submit"
            >
              返信
            </Button>
          </Box>
        </Box>
      )}

      <Divider sx={{ my: 1 }} />
      <Box sx={{ display: "flex", gap: 0.5 }}>
        <Tooltip title={resolved ? "解決済みのため返信できません" : "返信を追加"}>
          <span>
            <IconButton
              size="small"
              disabled={resolved}
              onClick={() => setReplyOpen((v) => !v)}
              aria-label="reply to comment"
              data-testid="comment-reply-toggle"
            >
              <ReplyIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={resolved ? "解決済みのため編集できません" : "コメントを編集"}>
          <span>
            <IconButton
              size="small"
              disabled={resolved}
              onClick={startEdit}
              aria-label="edit comment"
              data-testid="comment-edit"
            >
              <EditOutlinedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={resolved ? "未解決に戻す" : "解決済みにする"}>
          <IconButton
            size="small"
            onClick={() => onResolveToggle(c.id, resolved ? "open" : "resolved")}
            aria-label={resolved ? "reopen comment" : "resolve comment"}
            data-testid="comment-resolve-toggle"
          >
            {resolved ? (
              <ReplayIcon fontSize="small" />
            ) : (
              <CheckCircleOutlineIcon fontSize="small" />
            )}
          </IconButton>
        </Tooltip>
        <Box sx={{ flexGrow: 1 }} />
        <Tooltip title="コメントを削除">
          <IconButton
            size="small"
            onClick={() => onDelete(c.id)}
            aria-label="delete comment"
            data-testid="comment-delete"
          >
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
}
