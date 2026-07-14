import { useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Link from "@mui/material/Link";
import Tooltip from "@mui/material/Tooltip";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import CommentsDisabledIcon from "@mui/icons-material/CommentsDisabled";
import AddCommentIcon from "@mui/icons-material/AddComment";
import PublicIcon from "@mui/icons-material/Public";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ReplayIcon from "@mui/icons-material/Replay";
import ReplyIcon from "@mui/icons-material/Reply";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import RefreshIcon from "@mui/icons-material/Refresh";
import type { SxProps, Theme } from "@mui/material/styles";
import type { CommentJSON, CommentReply } from "@/api";
import { BAR_HEIGHT } from "@/theme/dimensions";

/** AI-authored comments/replies are read-only to the human reviewer: they can
 *  reply, resolve, and jump to them, but not edit the body or delete them. The
 *  marker is the "ai" author (mr CLI default; see cmd/mr/inbox.go). */
const AI_AUTHOR = "ai";
const isAiAuthored = (author?: string): boolean => author === AI_AUTHOR;

/** Comment/reply bodies longer than this are collapsed to a preview in the
 *  side-pane row, each with its own inline link to expand/collapse. The detail
 *  dialog always shows the full text. */
const BODY_PREVIEW_LIMIT = 200;

/** A text block that collapses to a `BODY_PREVIEW_LIMIT`-char preview when long,
 *  with an inline "続きを表示 / 折りたたむ" toggle. Each instance keeps its own
 *  expand state, so a comment body and each of its replies collapse
 *  independently. Short text renders in full with no toggle. */
function CollapsibleText({
  text,
  testid,
  sx,
}: {
  text: string;
  testid: string;
  sx?: SxProps<Theme>;
}) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > BODY_PREVIEW_LIMIT;
  return (
    <Typography variant="body2" sx={sx} data-testid={testid}>
      {long && !expanded ? `${text.slice(0, BODY_PREVIEW_LIMIT)}…` : text}
      {long && (
        <Link
          component="button"
          type="button"
          variant="caption"
          underline="hover"
          onClick={() => setExpanded((v) => !v)}
          data-testid={`${testid}-toggle`}
          sx={{ ml: 0.5, verticalAlign: "baseline" }}
        >
          {expanded ? "折りたたむ" : "続きを表示"}
        </Link>
      )}
    </Typography>
  );
}

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
  /** Re-fetch the comment list from the sidecar (e.g. to pick up AI replies
   *  added out-of-band). */
  onRefresh: () => void;
  /** Whether the current editor selection can take an anchored comment. */
  canAddComment: boolean;
  onAddComment: () => void;
  onAddGlobal: () => void;
  onDelete: (id: string) => void;
  onResolveToggle: (id: string, next: "open" | "resolved") => void;
  onReply: (id: string, body: string) => void;
  onEdit: (id: string, body: string) => void;
  /** Edit one threaded reply's body, addressed by its 0-based index. */
  onEditReply: (id: string, index: number, body: string) => void;
  /** Delete one threaded reply, addressed by its 0-based index. */
  onDeleteReply: (id: string, index: number) => void;
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
    return orig ? `${orig}（現在の本文には見つかりません）` : "位置不明 (orphan)";
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
  onRefresh,
  canAddComment,
  onAddComment,
  onAddGlobal,
  onDelete,
  onResolveToggle,
  onReply,
  onEdit,
  onEditReply,
  onDeleteReply,
  onJump,
}: Props) {
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [detailId, setDetailId] = useState<string | null>(null);
  // Look the comment up live so the dialog reflects refetched replies/edits;
  // if it was deleted out from under us, the dialog simply closes.
  const detailComment = useMemo(
    () => comments.find((c) => c.id === detailId) ?? null,
    [comments, detailId]
  );
  const openCount = useMemo(
    () => comments.filter((c) => c.status === "open").length,
    [comments]
  );
  const resolvedCount = comments.length - openCount;
  const visible = useMemo(
    () => (filter === "all" ? comments : comments.filter((c) => c.status === filter)),
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
          // Fixed height shared with the sidebar / editor headers so the
          // three dividers form one continuous line (#65, #90). BAR_HEIGHT = 37px.
          height: BAR_HEIGHT,
          flexShrink: 0,
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
        <Tooltip title="コメントを再取得">
          <IconButton
            size="small"
            onClick={onRefresh}
            aria-label="refresh comments"
            data-testid="comment-pane-refresh"
          >
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Tooltip>
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
          // Fixed height matching the editor file tab bar (BAR_HEIGHT = 37px,
          // border-box), so the second-row dividers form one continuous line
          // across the panes (#65, #90).
          height: BAR_HEIGHT,
          flexShrink: 0,
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
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
          <ToggleButton
            value="all"
            sx={{ textTransform: "none", py: 0.25 }}
            data-testid="comment-filter-all"
          >
            すべて ({comments.length})
          </ToggleButton>
          <ToggleButton
            value="open"
            sx={{ textTransform: "none", py: 0.25 }}
            data-testid="comment-filter-open"
          >
            未解決 ({openCount})
          </ToggleButton>
          <ToggleButton
            value="resolved"
            sx={{ textTransform: "none", py: 0.25 }}
            data-testid="comment-filter-resolved"
          >
            解決済 ({resolvedCount})
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      <Box
        sx={{
          px: 1.5,
          // Fixed height matching the other pane bars (BAR_HEIGHT = 37px,
          // border-box) so this row sits at the same visual height as the
          // sidebar filter / editor tab bar (#94). Single row, no wrap.
          height: BAR_HEIGHT,
          flexShrink: 0,
          boxSizing: "border-box",
          borderBottom: "1px solid",
          borderColor: "divider",
          display: "flex",
          alignItems: "center",
          gap: 0.75,
        }}
        data-testid="comment-add-toolbar"
      >
        <Tooltip title="選択範囲にコメントを追加（未取り込みなら自動で取り込む）">
          <span>
            <Button
              variant="outlined"
              size="small"
              startIcon={<AddCommentIcon />}
              disabled={!canAddComment}
              onClick={onAddComment}
              data-testid="editor-add-comment"
            >
              コメント
            </Button>
          </span>
        </Tooltip>
        <Tooltip title="ファイル全体に向けたコメントを追加（選択不要・未取り込みなら自動で取り込む）">
          <span>
            <Button
              variant="outlined"
              size="small"
              startIcon={<PublicIcon />}
              onClick={onAddGlobal}
              data-testid="editor-add-global-comment"
            >
              全体
            </Button>
          </span>
        </Tooltip>
      </Box>

      <Box sx={{ flex: 1, overflow: "auto" }}>
        {!reviewActive ? (
          <Box sx={{ p: 2 }}>
            <Typography variant="body2" color="text.secondary">
              このファイルはまだレビュー対象ではありません。テキストを選択して「コメント」（または「全体」）を押すと、自動で取り込んでレビューを開始します。
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
              onEditReply={onEditReply}
              onDeleteReply={onDeleteReply}
              onJump={onJump}
              onOpenDetail={setDetailId}
            />
          ))
        )}
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
        onJump={(id) => {
          onJump(id);
          setDetailId(null);
        }}
      />
    </Box>
  );
}

interface RowProps {
  comment: CommentJSON;
  onDelete: (id: string) => void;
  onResolveToggle: (id: string, next: "open" | "resolved") => void;
  onReply: (id: string, body: string) => void;
  onEdit: (id: string, body: string) => void;
  onEditReply: (id: string, index: number, body: string) => void;
  onDeleteReply: (id: string, index: number) => void;
  onJump: (id: string) => void;
  onOpenDetail: (id: string) => void;
}

function CommentRow({
  comment: c,
  onDelete,
  onResolveToggle,
  onReply,
  onEdit,
  onEditReply,
  onDeleteReply,
  onJump,
  onOpenDetail,
}: RowProps) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editBody, setEditBody] = useState(c.body);
  const ctx = contextLabel(c);
  const badge = SCOPE_BADGE[c.scope];
  const resolved = c.status === "resolved";
  const canJump = c.scope !== "global" && !c.orphan;
  const aiOwned = isAiAuthored(c.author);

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
        <CollapsibleText
          text={c.body}
          testid="comment-body"
          sx={{ mt: 0.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}
        />
      )}

      {c.replies && c.replies.length > 0 && (
        <Box sx={{ mt: 1, pl: 1, borderLeft: "2px solid", borderColor: "divider" }}>
          {c.replies.map((r, i) => (
            <ReplyRow
              key={i}
              reply={r}
              index={i}
              commentId={c.id}
              resolved={resolved}
              collapsible
              onEditReply={onEditReply}
              onDeleteReply={onDeleteReply}
            />
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
        <Tooltip
          title={
            aiOwned
              ? "AI のコメントは編集できません"
              : resolved
                ? "解決済みのため編集できません"
                : "コメントを編集"
          }
        >
          <span>
            <IconButton
              size="small"
              disabled={resolved || aiOwned}
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
        <Tooltip title="詳細を中央に開く">
          <IconButton
            size="small"
            onClick={() => onOpenDetail(c.id)}
            aria-label="open comment detail"
            data-testid="comment-open-detail"
          >
            <OpenInFullIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Box sx={{ flexGrow: 1 }} />
        <Tooltip title={aiOwned ? "AI のコメントは削除できません" : "コメントを削除"}>
          <span>
            <IconButton
              size="small"
              disabled={aiOwned}
              onClick={() => onDelete(c.id)}
              aria-label="delete comment"
              data-testid="comment-delete"
            >
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>
    </Box>
  );
}

interface ReplyRowProps {
  reply: CommentReply;
  /** 0-based position of this reply under its comment (the address the API uses). */
  index: number;
  commentId: string;
  /** A resolved comment is read-only, so its replies can't be edited/deleted. */
  resolved: boolean;
  /** Side-pane rows collapse long bodies; the detail dialog shows them in full. */
  collapsible: boolean;
  /** Test id for the row container (defaults to the side-pane reply id). */
  outerTestid?: string;
  onEditReply: (id: string, index: number, body: string) => void;
  onDeleteReply: (id: string, index: number) => void;
}

/** One threaded reply with its own inline edit form + edit/delete toolbar, so
 *  each reply is operable individually (not just the top-level comment). */
function ReplyRow({
  reply: r,
  index,
  commentId,
  resolved,
  collapsible,
  outerTestid = "comment-reply",
  onEditReply,
  onDeleteReply,
}: ReplyRowProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [editBody, setEditBody] = useState(r.body);
  const aiOwned = isAiAuthored(r.author);

  const startEdit = () => {
    setEditBody(r.body);
    setEditOpen(true);
  };
  const submitEdit = () => {
    const body = editBody.trim();
    if (!body || body === r.body) {
      setEditOpen(false);
      return;
    }
    onEditReply(commentId, index, body);
    setEditOpen(false);
  };

  return (
    <Box sx={{ mb: 0.5 }} data-testid={outerTestid}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
        <Typography variant="caption" color="text.secondary" sx={{ flexGrow: 1 }}>
          {r.author || "?"} {r.date ? `· ${r.date}` : ""}
        </Typography>
        {!editOpen && (
          <>
            <Tooltip
              title={
                aiOwned
                  ? "AI の返信は編集できません"
                  : resolved
                    ? "解決済みのため編集できません"
                    : "返信を編集"
              }
            >
              <span>
                <IconButton
                  size="small"
                  disabled={resolved || aiOwned}
                  onClick={startEdit}
                  aria-label="edit reply"
                  data-testid="comment-reply-edit"
                  sx={{ p: 0.25 }}
                >
                  <EditOutlinedIcon sx={{ fontSize: 15 }} />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip
              title={
                aiOwned
                  ? "AI の返信は削除できません"
                  : resolved
                    ? "解決済みのため削除できません"
                    : "返信を削除"
              }
            >
              <span>
                <IconButton
                  size="small"
                  disabled={resolved || aiOwned}
                  onClick={() => onDeleteReply(commentId, index)}
                  aria-label="delete reply"
                  data-testid="comment-reply-delete"
                  sx={{ p: 0.25 }}
                >
                  <DeleteOutlineIcon sx={{ fontSize: 15 }} />
                </IconButton>
              </span>
            </Tooltip>
          </>
        )}
      </Box>

      {editOpen && !resolved ? (
        <Box>
          <TextField
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            multiline
            minRows={2}
            fullWidth
            size="small"
            autoFocus
            inputProps={{ "data-testid": "comment-reply-edit-input" }}
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
              data-testid="comment-reply-edit-submit"
            >
              更新
            </Button>
          </Box>
        </Box>
      ) : collapsible ? (
        <CollapsibleText
          text={r.body}
          testid="comment-reply-body"
          sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
        />
      ) : (
        <Typography
          variant="body2"
          sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
          data-testid="comment-detail-reply-body"
        >
          {r.body}
        </Typography>
      )}
    </Box>
  );
}

interface DetailDialogProps {
  comment: CommentJSON | null;
  onClose: () => void;
  onDelete: (id: string) => void;
  onResolveToggle: (id: string, next: "open" | "resolved") => void;
  onReply: (id: string, body: string) => void;
  onEdit: (id: string, body: string) => void;
  onEditReply: (id: string, index: number, body: string) => void;
  onDeleteReply: (id: string, index: number) => void;
  onJump: (id: string) => void;
}

/** A roomy, centered view of one comment: full target, body, the whole reply
 *  thread, and the same actions as the side-pane row. Opened from a row's
 *  "詳細" button; closes when the comment is deleted or jumped to. */
function CommentDetailDialog({
  comment: c,
  onClose,
  onDelete,
  onResolveToggle,
  onReply,
  onEdit,
  onEditReply,
  onDeleteReply,
  onJump,
}: DetailDialogProps) {
  const [replyBody, setReplyBody] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editBody, setEditBody] = useState("");

  const open = c !== null;
  // Reset the inline forms whenever a different comment is shown.
  const shownId = c?.id ?? null;
  const [lastId, setLastId] = useState<string | null>(null);
  if (shownId !== lastId) {
    setLastId(shownId);
    setReplyBody("");
    setEditOpen(false);
    setEditBody(c?.body ?? "");
  }

  if (!c) {
    return <Dialog open={false} onClose={onClose} />;
  }

  const resolved = c.status === "resolved";
  const canJump = c.scope !== "global" && !c.orphan;
  const ctx = contextLabel(c);
  const badge = SCOPE_BADGE[c.scope];
  const aiOwned = isAiAuthored(c.author);

  const submitReply = () => {
    const body = replyBody.trim();
    if (!body) return;
    onReply(c.id, body);
    setReplyBody("");
  };
  const submitEdit = () => {
    const body = editBody.trim();
    if (body && body !== c.body) onEdit(c.id, body);
    setEditOpen(false);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      data-testid="comment-detail-dialog"
    >
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, pb: 1 }}>
        {badge && (
          <Chip
            label={badge.label}
            size="small"
            sx={{ height: 20, fontSize: "0.7rem", bgcolor: badge.color }}
          />
        )}
        {resolved && (
          <Chip
            label="resolved"
            size="small"
            color="success"
            variant="outlined"
            sx={{ height: 20 }}
          />
        )}
        {c.orphan && (
          <Chip
            label="orphan"
            size="small"
            color="warning"
            variant="outlined"
            sx={{ height: 20 }}
          />
        )}
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ flexGrow: 1, textAlign: "right" }}
        >
          {c.author || "?"} {c.date ? `· ${c.date}` : ""}
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        {ctx && (
          <Typography
            variant="body2"
            color="text.secondary"
            onClick={canJump ? () => onJump(c.id) : undefined}
            sx={{
              fontStyle: "italic",
              wordBreak: "break-word",
              mb: 1,
              cursor: canJump ? "pointer" : "default",
              "&:hover": canJump ? { textDecoration: "underline" } : undefined,
            }}
          >
            対象: {ctx}
          </Typography>
        )}

        {editOpen && !resolved ? (
          <Box>
            <TextField
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              multiline
              minRows={3}
              fullWidth
              autoFocus
              inputProps={{ "data-testid": "comment-detail-edit-input" }}
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
                data-testid="comment-detail-edit-submit"
              >
                更新
              </Button>
            </Box>
          </Box>
        ) : (
          <Typography
            variant="body1"
            sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
          >
            {c.body}
          </Typography>
        )}

        {c.replies && c.replies.length > 0 && (
          <Box sx={{ mt: 2, pl: 1.5, borderLeft: "3px solid", borderColor: "divider" }}>
            {c.replies.map((r, i) => (
              <ReplyRow
                key={i}
                reply={r}
                index={i}
                commentId={c.id}
                resolved={resolved}
                collapsible={false}
                outerTestid="comment-detail-reply"
                onEditReply={onEditReply}
                onDeleteReply={onDeleteReply}
              />
            ))}
          </Box>
        )}

        {!resolved && (
          <Box sx={{ mt: 2 }}>
            <TextField
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              placeholder="返信を入力"
              multiline
              minRows={2}
              fullWidth
              size="small"
              inputProps={{ "data-testid": "comment-detail-reply-input" }}
            />
            <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 0.5 }}>
              <Button
                size="small"
                variant="contained"
                onClick={submitReply}
                disabled={!replyBody.trim()}
                data-testid="comment-detail-reply-submit"
              >
                返信
              </Button>
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ justifyContent: "space-between", px: 2 }}>
        <Box>
          <Tooltip
            title={
              aiOwned
                ? "AI のコメントは編集できません"
                : resolved
                  ? "解決済みのため編集できません"
                  : "コメントを編集"
            }
          >
            <span>
              <IconButton
                size="small"
                disabled={resolved || aiOwned}
                onClick={() => setEditOpen((v) => !v)}
                aria-label="edit comment"
                data-testid="comment-detail-edit"
              >
                <EditOutlinedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title={aiOwned ? "AI のコメントは削除できません" : "コメントを削除"}>
            <span>
              <IconButton
                size="small"
                disabled={aiOwned}
                onClick={() => onDelete(c.id)}
                aria-label="delete comment"
                data-testid="comment-detail-delete"
              >
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
        <Box>
          <Button
            size="small"
            startIcon={resolved ? <ReplayIcon /> : <CheckCircleOutlineIcon />}
            onClick={() => onResolveToggle(c.id, resolved ? "open" : "resolved")}
            data-testid="comment-detail-resolve-toggle"
          >
            {resolved ? "未解決に戻す" : "解決済みにする"}
          </Button>
          <Button size="small" onClick={onClose}>
            閉じる
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
}
