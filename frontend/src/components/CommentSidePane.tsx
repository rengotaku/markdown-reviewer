import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { Editor } from "@tiptap/react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Button from "@mui/material/Button";
import Tooltip from "@mui/material/Tooltip";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import CommentsDisabledIcon from "@mui/icons-material/CommentsDisabled";
import AddCommentIcon from "@mui/icons-material/AddComment";
import PublicIcon from "@mui/icons-material/Public";
import HubIcon from "@mui/icons-material/Hub";
import Chip from "@mui/material/Chip";
import { collectComments, type CollectedComment } from "@/utils/collectComments";
import { decodeSections } from "@/utils/headings";

const SCOPE_BADGE: Record<string, { label: string; color: string }> = {
  block: { label: "block", color: "#fff8c5" },
  "cross-section": { label: "横断", color: "#fef3c7" },
  global: { label: "全体", color: "#e0f2fe" },
};

interface EditableComment {
  id: string;
  scope: string;
  target: string;
  body: string;
}

interface Props {
  editor: Editor | null;
  onDelete: (id: string) => void;
  onEdit?: (comment: EditableComment) => void;
  onClose?: () => void;
  activeId?: string | null;
  /** Whether the current editor selection can take an anchored comment. */
  canAddComment?: boolean;
  /** Add an anchored comment on the current selection. */
  onAddComment?: () => void;
  /** Add a file-wide (global) comment. */
  onAddGlobal?: () => void;
  /** Add a cross-section comment spanning multiple headings. */
  onAddCrossSection?: () => void;
}

interface CommentSnapshot {
  comments: CollectedComment[];
  fingerprint: string;
}

const EMPTY_SNAPSHOT: CommentSnapshot = { comments: [], fingerprint: "" };

function fingerprintOf(comments: CollectedComment[]): string {
  return comments
    .map(
      (c) =>
        `${c.id}|${c.from}|${c.to}|${c.body}|${c.target}|${c.scope}|${c.groupId}`
    )
    .join("\n");
}

/**
 * One row in the side pane. For comments that share a `groupId`, the row
 * represents the whole group: `memberIds` lists every anchored marker in
 * doc order, and `target` is the newline-joined list of anchored heading
 * texts (so the existing decodeSections rendering keeps working).
 */
interface DisplayComment {
  id: string;
  memberIds: string[];
  author: string;
  date: string;
  body: string;
  scope: string;
  groupId: string;
  target: string;
  from: number;
  to: number;
}

function buildDisplayComments(
  comments: ReadonlyArray<CollectedComment>
): DisplayComment[] {
  const seenGroup = new Set<string>();
  const out: DisplayComment[] = [];
  for (const c of comments) {
    if (c.groupId) {
      if (seenGroup.has(c.groupId)) continue;
      seenGroup.add(c.groupId);
      const members = comments.filter((m) => m.groupId === c.groupId);
      out.push({
        id: members[0].id,
        memberIds: members.map((m) => m.id),
        author: members[0].author,
        date: members[0].date,
        body: members[0].body,
        // Surface grouped comments as "cross-section" in the UI even though
        // each underlying marker carries scope="block" on disk.
        scope: "cross-section",
        groupId: c.groupId,
        target: members.map((m) => m.target).filter(Boolean).join("\n"),
        from: members[0].from,
        to: members[0].to,
      });
      continue;
    }
    out.push({
      id: c.id,
      memberIds: [c.id],
      author: c.author,
      date: c.date,
      body: c.body,
      scope: c.scope,
      groupId: "",
      target: c.target,
      from: c.from,
      to: c.to,
    });
  }
  return out;
}

function useEditorComments(editor: Editor | null): CollectedComment[] {
  const cacheRef = useRef<CommentSnapshot>(EMPTY_SNAPSHOT);

  // Reset cache when the editor instance changes.
  useEffect(() => {
    cacheRef.current = EMPTY_SNAPSHOT;
  }, [editor]);

  const subscribe = useMemo(
    () => (cb: () => void) => {
      if (!editor) return () => undefined;
      editor.on("update", cb);
      editor.on("transaction", cb);
      return () => {
        editor.off("update", cb);
        editor.off("transaction", cb);
      };
    },
    [editor]
  );

  const getSnapshot = () => {
    const next = collectComments(editor);
    const fingerprint = fingerprintOf(next);
    if (fingerprint === cacheRef.current.fingerprint) {
      return cacheRef.current.comments;
    }
    cacheRef.current = { comments: next, fingerprint };
    return next;
  };

  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_SNAPSHOT.comments);
}

export function CommentSidePane({
  editor,
  onDelete,
  onEdit,
  onClose,
  activeId,
  canAddComment = false,
  onAddComment,
  onAddGlobal,
  onAddCrossSection,
}: Props) {
  const comments = useEditorComments(editor);
  const displayComments = useMemo(() => buildDisplayComments(comments), [comments]);

  const flashMarks = (ids: ReadonlyArray<string>) => {
    const root = editor?.view?.dom;
    if (!root) return;
    const selector = ids
      .filter((id) => id.length > 0)
      .map((id) => `[data-comment-id="${CSS.escape(id)}"]`)
      .join(",");
    if (!selector) return;
    const nodes = root.querySelectorAll<HTMLElement>(selector);
    if (nodes.length === 0) return;
    nodes[0].scrollIntoView({ behavior: "smooth", block: "center" });
    nodes.forEach((el) => {
      el.classList.remove("is-flash");
      // Force reflow so re-adding the class restarts the animation.
      void el.offsetWidth;
      el.classList.add("is-flash");
    });
    window.setTimeout(() => {
      nodes.forEach((el) => el.classList.remove("is-flash"));
    }, 1600);
  };

  // Click in the side pane: just flash (no text selection / no focus jump).
  // For grouped (cross-section) comments every anchored marker blinks.
  const handleJump = (d: DisplayComment) => {
    flashMarks(d.memberIds);
  };

  const handleDelete = (d: DisplayComment) => {
    for (const id of d.memberIds) {
      onDelete(id);
    }
  };

  const handleEdit = (d: DisplayComment) => {
    if (!onEdit) return;
    // Pass any member id; the update commands sweep all grouped members.
    onEdit({
      id: d.memberIds[0] ?? d.id,
      scope: d.scope,
      target: d.target,
      body: d.body,
    });
  };


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
          Comments ({displayComments.length})
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
      {(onAddComment || onAddGlobal || onAddCrossSection) && (
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
          {onAddComment && (
            <Tooltip title="選択範囲にコメントを追加">
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
          )}
          {onAddGlobal && (
            <Tooltip title="ファイル全体に向けたコメントを追加（選択不要）">
              <span>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<PublicIcon />}
                  disabled={!editor}
                  onClick={onAddGlobal}
                  data-testid="editor-add-global-comment"
                >
                  全体
                </Button>
              </span>
            </Tooltip>
          )}
          {onAddCrossSection && (
            <Tooltip title="複数の見出しに紐付ける横断コメントを追加">
              <span>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<HubIcon />}
                  disabled={!editor}
                  onClick={onAddCrossSection}
                  data-testid="editor-add-cross-section-comment"
                >
                  横断
                </Button>
              </span>
            </Tooltip>
          )}
        </Box>
      )}
      <Box sx={{ flex: 1, overflow: "auto" }}>
        {displayComments.length === 0 ? (
          <Box sx={{ p: 2 }}>
            <Typography variant="body2" color="text.secondary">
              コメントはまだありません。テキストを選択して「コメント」を押すと追加できます。
            </Typography>
          </Box>
        ) : (
          displayComments.map((d) => (
            <Box
              key={d.id || `${d.from}-${d.to}`}
              role="button"
              tabIndex={0}
              onClick={() => handleJump(d)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleJump(d);
                }
              }}
              data-testid="comment-item"
              data-comment-id={d.id}
              data-comment-group-id={d.groupId || undefined}
              sx={{
                p: 1.5,
                borderBottom: "1px solid",
                borderColor: "divider",
                cursor: "pointer",
                bgcolor:
                  activeId && d.memberIds.includes(activeId)
                    ? "action.selected"
                    : "transparent",
                "&:hover": { bgcolor: "action.hover" },
              }}
            >
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  mb: 0.5,
                }}
              >
                {SCOPE_BADGE[d.scope] && (
                  <Chip
                    label={
                      d.scope === "cross-section" && d.memberIds.length > 1
                        ? `${SCOPE_BADGE[d.scope].label} (${d.memberIds.length})`
                        : SCOPE_BADGE[d.scope].label
                    }
                    size="small"
                    sx={{
                      height: 18,
                      fontSize: "0.65rem",
                      bgcolor: SCOPE_BADGE[d.scope].color,
                      "& .MuiChip-label": { px: 0.75 },
                    }}
                    data-testid={`comment-scope-${d.scope}`}
                  />
                )}
                <Typography variant="caption" color="text.secondary" sx={{ flexGrow: 1 }}>
                  {d.date || "?"}
                </Typography>
                {onEdit && (
                  <Tooltip title="コメントを編集">
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEdit(d);
                      }}
                      aria-label="edit comment"
                      data-testid="comment-edit"
                    >
                      <EditOutlinedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
                <Tooltip title="コメントを削除">
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(d);
                    }}
                    aria-label="delete comment"
                    data-testid="comment-delete"
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
              {d.target && d.scope === "cross-section" ? (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{
                    display: "block",
                    fontStyle: "italic",
                    wordBreak: "break-word",
                  }}
                  data-testid={`comment-sections-${d.id}`}
                >
                  対象: {decodeSections(d.target).join(" ・ ")}
                </Typography>
              ) : d.target ? (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{
                    display: "block",
                    fontStyle: "italic",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  対象: {d.target}
                </Typography>
              ) : null}
              <Typography
                variant="body2"
                sx={{
                  mt: 0.5,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {d.body}
              </Typography>
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
}
