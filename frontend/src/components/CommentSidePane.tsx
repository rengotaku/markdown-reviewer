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
import LinkIcon from "@mui/icons-material/Link";
import type { SxProps, Theme } from "@mui/material/styles";
import type { SystemStyleObject } from "@mui/system";
import type { CommentJSON, CommentReply } from "@/api";
import { BAR_HEIGHT } from "@/theme/dimensions";
import { renderCommentMarkdown } from "@/utils/commentMarkdown";
import { buildCommentDeepLink } from "@/utils/deeplink";
import { useToast } from "@/hooks/useToast";
import { markdownBodySx } from "./markdownBodySx";
import { contextLabel } from "@/utils/commentContext";
import { isAiAuthored } from "@/utils/commentPresentation";
import { CommentAuthor } from "./CommentAuthor";

/** AI-authored comments/replies are read-only to the human reviewer: they can
 *  reply, resolve, and jump to them, but not edit the body or delete them. */

/** Comment/reply bodies longer than this are collapsed to a preview in the
 *  side-pane row, each with its own inline link to expand/collapse. The detail
 *  dialog always shows the full text. */
const BODY_PREVIEW_LIMIT = 200;

/** CSS-only height clamp for a collapsed long body: unlike slicing the
 *  Markdown source (which breaks mid-syntax — a table or fence cut in half),
 *  the full source is always rendered and only the *visual* height is capped,
 *  with a bottom fade hinting there's more. */
function clampSx(theme: Theme): SystemStyleObject<Theme> {
  return {
    maxHeight: "6em",
    overflow: "hidden",
    position: "relative",
    "&::after": {
      content: '""',
      position: "absolute",
      insetInline: 0,
      bottom: 0,
      height: "1.5em",
      background: `linear-gradient(to bottom, transparent, ${theme.palette.background.default})`,
      pointerEvents: "none",
    },
  };
}

/** Renders a comment/reply's full Markdown source (#147) and collapses tall
 *  bodies to a CSS-clamped preview with an inline "続きを表示 / 折りたたむ"
 *  toggle below it. Each instance keeps its own expand state, so a comment
 *  body and each of its replies collapse independently. The clamp is purely
 *  visual — the full source is always in the DOM, so mid-syntax truncation
 *  (a half-rendered table/fence) can't happen. Short text renders in full
 *  with no toggle. */
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
  const collapsed = long && !expanded;
  return (
    <Box>
      <Typography
        variant="body2"
        component="div"
        data-testid={testid}
        data-collapsed={String(collapsed)}
        // XSS-safe: see commentMarkdown.ts (html:false + unmodified validateLink()).
        dangerouslySetInnerHTML={{ __html: renderCommentMarkdown(text) }}
        sx={[sx ?? false, markdownBodySx, collapsed ? clampSx : false].filter(
          Boolean
        ) as SxProps<Theme>}
      />
      {long && (
        <Link
          component="button"
          type="button"
          variant="caption"
          underline="hover"
          onClick={() => setExpanded((v) => !v)}
          data-testid={`${testid}-toggle`}
          sx={{ display: "block", mt: 0.25 }}
        >
          {expanded ? "折りたたむ" : "続きを表示"}
        </Link>
      )}
    </Box>
  );
}

const SCOPE_BADGE: Record<string, { label: string; color: string }> = {
  inline: { label: "inline", color: "#fff8c5" },
  block: { label: "block", color: "#fff8c5" },
  cross_section: { label: "横断", color: "#fef3c7" },
  global: { label: "全体", color: "#e0f2fe" },
};

interface Props {
  root?: string;
  filePath?: string;
  comments: ReadonlyArray<CommentJSON>;
  /** The active file is under review (draft files cannot take comments). */
  reviewActive: boolean;
  onClose?: () => void;
  /** Re-fetch the comment list from the sidecar (e.g. to pick up AI replies
   *  added out-of-band). */
  onRefresh: () => void;
  /** Whether the current editor selection can take an anchored comment. */
  canAddComment: boolean;
  /** Both receive the trigger button's rect: the composer opens beside it
   *  rather than in a centre modal (#252). */
  onAddComment: (anchor: DOMRect) => void;
  onAddGlobal: (anchor: DOMRect) => void;
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
  /** Open an anchored comment: the editor scrolls to it and opens its thread
   *  beside the text (#253). Reading and replying happen there, not here. */
  onSelect: (id: string) => void;
  /** The comment whose thread is currently open, if it is one of these. */
  selectedId?: string | null;
}

type StatusFilter = "all" | "open" | "resolved";

export function CommentSidePane({
  root,
  filePath,
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
  onSelect,
  selectedId,
}: Props) {
  const canCopyLink = Boolean(root && filePath);
  const handleCopyLink = async (id: string) => {
    if (!root || !filePath) return;
    const url = buildCommentDeepLink(window.location.origin, root, filePath, id);
    try {
      await navigator.clipboard.writeText(url);
      useToast.getState().show("リンクをコピーしました", "success");
    } catch {
      useToast.getState().show("リンクのコピーに失敗しました", "error");
    }
  };

  // Unresolved by default (#253): the pane exists to show what still needs an
  // answer, and a finished review is mostly resolved rows.
  const [filter, setFilter] = useState<StatusFilter>("open");
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
  // Comments with no live anchor cannot open a popover beside the text, so
  // they get their own section at the top and stay operable here (#253).
  const pinned = useMemo(
    () => visible.filter((c) => c.scope === "global" || c.orphan),
    [visible]
  );
  const anchored = useMemo(
    () => visible.filter((c) => !(c.scope === "global" || c.orphan)),
    [visible]
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
          // #143: この 1 行目の下線は廃止した。BAR_HEIGHT 固定は、直下の
          // フィルタ行（2 行目）のディバイダを他ペインの 2 行目と揃えて
          // 1 本の連続線にするために引き続き必要（#65, #90）。
          height: BAR_HEIGHT,
          flexShrink: 0,
          boxSizing: "border-box",
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

      {/* Filter + add actions share one row (#196). They used to occupy two
          BAR_HEIGHT rows, which cost 37px of comment list for controls that fit
          side by side once the add buttons drop their labels. The three counts
          stay visible at once — "how many are still open" is the number this
          pane exists to show, so the filter is never collapsed into a select.
          Measured: pane inner width 295px = filter ~225px + two icon buttons. */}
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
          gap: 0.75,
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
        data-testid="comment-add-toolbar"
      >
        <ToggleButtonGroup
          value={filter}
          exclusive
          size="small"
          onChange={(_, v) => {
            if (v !== null) setFilter(v as StatusFilter);
          }}
          aria-label="コメントの表示フィルタ"
          data-testid="comment-status-filter"
          sx={{
            flex: 1,
            minWidth: 0,
            // Let the three buttons share the space evenly and shrink together
            // rather than pushing the icon buttons off the row when the counts
            // grow to two or three digits.
            // The counts are unbounded, so the label must degrade instead of
            // spilling into the neighbouring button. Parentheses are dropped
            // (they cost ~10px and carry no meaning here), and anything that
            // still doesn't fit is ellipsised rather than overlapping.
            // Measured at 12px: content box 67px, "すべて 100" ≈ 57px.
            "& .MuiToggleButton-root": {
              flex: 1,
              minWidth: 0,
              textTransform: "none",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              display: "block",
              textAlign: "center",
              py: 0.5,
              px: 0.5,
              fontSize: "0.75rem",
              lineHeight: 1.2,
            },
          }}
        >
          <ToggleButton value="all" data-testid="comment-filter-all">
            すべて {comments.length}
          </ToggleButton>
          <ToggleButton value="open" data-testid="comment-filter-open">
            未解決 {openCount}
          </ToggleButton>
          <ToggleButton value="resolved" data-testid="comment-filter-resolved">
            解決済 {resolvedCount}
          </ToggleButton>
        </ToggleButtonGroup>
        <Tooltip title="選択範囲にコメントを追加（未取り込みなら自動で取り込む）">
          <span>
            <IconButton
              size="small"
              color="primary"
              disabled={!canAddComment}
              onClick={(e) => onAddComment(e.currentTarget.getBoundingClientRect())}
              aria-label="選択範囲にコメントを追加"
              data-testid="editor-add-comment"
              sx={{ flexShrink: 0 }}
            >
              <AddCommentIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="ファイル全体に向けたコメントを追加（選択不要・未取り込みなら自動で取り込む）">
          <span>
            <IconButton
              size="small"
              color="primary"
              onClick={(e) => onAddGlobal(e.currentTarget.getBoundingClientRect())}
              aria-label="ファイル全体にコメントを追加"
              data-testid="editor-add-global-comment"
              sx={{ flexShrink: 0 }}
            >
              <PublicIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      <Box sx={{ flex: 1, overflow: "auto" }}>
        {!reviewActive ? (
          <Box sx={{ p: 2 }}>
            <Typography variant="body2" color="text.secondary">
              このファイルはまだレビュー対象ではありません。テキストを選択してこの上のコメント追加ボタン（吹き出しのアイコン／ファイル全体なら地球のアイコン）を押すと、自動で取り込んでレビューを開始します。
            </Typography>
          </Box>
        ) : comments.length === 0 ? (
          <Box sx={{ p: 2 }}>
            <Typography variant="body2" color="text.secondary">
              コメントはまだありません。テキストを選択してこの上のコメント追加ボタン（吹き出しのアイコン）を押すと追加できます。
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
          <>
            {pinned.length > 0 && (
              <Box data-testid="comment-pinned-section">
                <Typography
                  variant="caption"
                  sx={{
                    display: "block",
                    px: 1.5,
                    py: 0.75,
                    color: "text.secondary",
                    bgcolor: "action.hover",
                    borderBottom: "1px solid",
                    borderColor: "divider",
                    letterSpacing: ".04em",
                  }}
                >
                  全体・位置不明 {pinned.length}
                </Typography>
                {pinned.map((c) => (
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
                    onCopyLink={handleCopyLink}
                    canCopyLink={canCopyLink}
                  />
                ))}
              </Box>
            )}
            {anchored.map((c) => (
              <CommentCard
                key={c.id}
                comment={c}
                selected={c.id === selectedId}
                onSelect={onSelect}
                onCopyLink={handleCopyLink}
                canCopyLink={canCopyLink}
              />
            ))}
          </>
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
        onCopyLink={handleCopyLink}
        canCopyLink={canCopyLink}
      />
    </Box>
  );
}

interface CardProps {
  comment: CommentJSON;
  selected: boolean;
  onSelect: (id: string) => void;
  onCopyLink: (id: string) => void;
  canCopyLink?: boolean;
}

/** One anchored comment as a list entry (#253). The pane is where a comment is
 *  found; it is read and answered in the thread the editor opens beside the
 *  text, so this row carries no reply box, no edit form and no resolve button —
 *  only what tells the reader which comment this is. */
function CommentCard({
  comment: c,
  selected,
  onSelect,
  onCopyLink,
  canCopyLink = true,
}: CardProps) {
  const ctx = contextLabel(c);
  const badge = SCOPE_BADGE[c.scope];
  const replies = c.replies?.length ?? 0;
  const resolved = c.status === "resolved";

  return (
    <Box
      role="button"
      tabIndex={0}
      data-testid="comment-item"
      data-comment-id={c.id}
      data-comment-status={c.status}
      data-selected={String(selected)}
      onClick={() => onSelect(c.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(c.id);
        }
      }}
      sx={{
        px: 1.5,
        py: 1.25,
        cursor: "pointer",
        borderBottom: "1px solid",
        borderColor: "divider",
        // The open thread's entry stays marked, so the list and the editor
        // agree on what is being looked at.
        borderLeft: "3px solid",
        borderLeftColor: selected ? "primary.main" : "transparent",
        bgcolor: selected ? "action.selected" : undefined,
        opacity: resolved ? 0.6 : 1,
        "&:hover": { bgcolor: selected ? "action.selected" : "action.hover" },
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
        <CommentAuthor author={c.author} date={c.date} />
        <Box sx={{ flexGrow: 1 }} />
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
        <Tooltip
          title={
            canCopyLink ? "リンクをコピー" : "ファイルが開かれていないためコピーできません"
          }
        >
          <span>
            <IconButton
              size="small"
              disabled={!canCopyLink}
              // The row itself opens the thread; this button must not.
              onClick={(e) => {
                e.stopPropagation();
                onCopyLink(c.id);
              }}
              aria-label="copy comment link"
              data-testid="comment-copy-link"
              sx={{ p: 0.25 }}
            >
              <LinkIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      {ctx && (
        <Typography
          variant="caption"
          color="text.secondary"
          data-testid={`comment-context-${c.id}`}
          sx={{ display: "block", fontStyle: "italic", wordBreak: "break-word" }}
        >
          対象: {ctx}
        </Typography>
      )}

      <CollapsibleText
        text={c.body}
        testid="comment-body"
        sx={{ mt: 0.5, wordBreak: "break-word" }}
      />

      {replies > 0 && (
        <Typography
          variant="caption"
          color="text.disabled"
          data-testid="comment-reply-count"
          sx={{ display: "block", mt: 0.75 }}
        >
          返信 {replies} 件
        </Typography>
      )}
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
  onCopyLink: (id: string) => void;
  canCopyLink?: boolean;
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
  onCopyLink,
  canCopyLink = true,
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
      <Box
        data-testid="comment-header"
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          mb: 0.75,
          mx: -1.5,
          mt: -1.5,
          px: 1.5,
          py: 0.75,
          bgcolor: "action.hover",
        }}
      >
        <Box
          aria-hidden
          sx={{
            width: 3,
            alignSelf: "stretch",
            borderRadius: 1,
            bgcolor: "primary.main",
            flexShrink: 0,
          }}
        />
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
        <Typography variant="body2" sx={{ fontWeight: 600, color: "text.primary" }}>
          {c.author || "?"}
        </Typography>
        {c.date && (
          <Typography variant="caption" color="text.secondary">
            · {c.date}
          </Typography>
        )}
        <Box sx={{ flexGrow: 1 }} />
        {!editOpen && (
          <>
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
                  sx={{ p: 0.25 }}
                >
                  <EditOutlinedIcon sx={{ fontSize: 16 }} />
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
                  data-testid="comment-delete"
                  sx={{ p: 0.25 }}
                >
                  <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </span>
            </Tooltip>
          </>
        )}
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
          sx={{ mt: 0.5, wordBreak: "break-word" }}
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
        <Tooltip title={canCopyLink ? "リンクをコピー" : "ファイルが開かれていないためコピーできません"}>
          <span>
            <IconButton
              size="small"
              disabled={!canCopyLink}
              onClick={() => onCopyLink(c.id)}
              aria-label="copy comment link"
              data-testid="comment-copy-link"
            >
              <LinkIcon fontSize="small" />
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

  // Only the side-pane thread row uses the shared "comment-reply-header"
  // testid; the detail dialog's copy of this row gets its own name so the
  // two can never collide when both render at once (comment open in detail
  // view while its thread is also visible in the side pane).
  const headerTestid =
    outerTestid === "comment-reply" ? "comment-reply-header" : "comment-detail-reply-header";

  return (
    <Box sx={{ mb: 0.5 }} data-testid={outerTestid}>
      <Box
        data-testid={headerTestid}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.75,
          px: 1,
          py: 0.5,
          mb: 0.25,
          borderRadius: 1,
          bgcolor: "action.hover",
        }}
      >
        <Box
          aria-hidden
          sx={{
            width: 3,
            alignSelf: "stretch",
            borderRadius: 1,
            bgcolor: "primary.main",
            flexShrink: 0,
          }}
        />
        <Typography variant="caption" sx={{ fontWeight: 600, color: "text.primary" }}>
          {r.author || "?"}
        </Typography>
        {r.date && (
          <Typography variant="caption" color="text.secondary">
            · {r.date}
          </Typography>
        )}
        <Box sx={{ flexGrow: 1 }} />
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
          sx={{ wordBreak: "break-word" }}
        />
      ) : (
        <Typography
          variant="body2"
          component="div"
          sx={[{ wordBreak: "break-word" }, markdownBodySx]}
          data-testid="comment-detail-reply-body"
          // XSS-safe: see commentMarkdown.ts (html:false + unmodified validateLink()).
          dangerouslySetInnerHTML={{ __html: renderCommentMarkdown(r.body) }}
        />
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
  onCopyLink: (id: string) => void;
  canCopyLink?: boolean;
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
  onCopyLink,
  canCopyLink = true,
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
      <DialogTitle
        data-testid="comment-detail-header"
        sx={{ display: "flex", alignItems: "center", gap: 1, bgcolor: "action.hover" }}
      >
        <Box
          aria-hidden
          sx={{
            width: 3,
            alignSelf: "stretch",
            borderRadius: 1,
            bgcolor: "primary.main",
            flexShrink: 0,
          }}
        />
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
        <Typography variant="body2" sx={{ fontWeight: 600, color: "text.primary" }}>
          {c.author || "?"}
        </Typography>
        {c.date && (
          <Typography variant="caption" color="text.secondary">
            · {c.date}
          </Typography>
        )}
        <Box sx={{ flexGrow: 1 }} />
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
            component="div"
            sx={[{ wordBreak: "break-word" }, markdownBodySx]}
            // XSS-safe: see commentMarkdown.ts (html:false + unmodified validateLink()).
            dangerouslySetInnerHTML={{ __html: renderCommentMarkdown(c.body) }}
          />
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
          <Tooltip title={canCopyLink ? "リンクをコピー" : "ファイルが開かれていないためコピーできません"}>
            <span>
              <IconButton
                size="small"
                disabled={!canCopyLink}
                onClick={() => onCopyLink(c.id)}
                aria-label="copy comment link"
                data-testid="comment-detail-copy-link"
              >
                <LinkIcon fontSize="small" />
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
