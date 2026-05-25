import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { Editor } from "@tiptap/react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import CommentsDisabledIcon from "@mui/icons-material/CommentsDisabled";
import Chip from "@mui/material/Chip";
import { collectComments, type CollectedComment } from "@/utils/collectComments";

const SCOPE_BADGE: Record<string, { label: string; color: string }> = {
  block: { label: "block", color: "#fff8c5" },
  "cross-section": { label: "横断", color: "#fef3c7" },
  global: { label: "全体", color: "#e0f2fe" },
};

interface Props {
  editor: Editor | null;
  onDelete: (id: string) => void;
  onClose?: () => void;
  activeId?: string | null;
}

interface CommentSnapshot {
  comments: CollectedComment[];
  fingerprint: string;
}

const EMPTY_SNAPSHOT: CommentSnapshot = { comments: [], fingerprint: "" };

function fingerprintOf(comments: CollectedComment[]): string {
  return comments
    .map((c) => `${c.id}|${c.from}|${c.to}|${c.body}|${c.target}|${c.scope}`)
    .join("\n");
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

export function CommentSidePane({ editor, onDelete, onClose, activeId }: Props) {
  const comments = useEditorComments(editor);

  const flashMark = (id: string) => {
    if (!id) return;
    const root = editor?.view?.dom;
    if (!root) return;
    // Match both inline marks (.comment-mark) and standalone nodes
    // (.standalone-comment) via their shared data-comment-id attribute.
    const nodes = root.querySelectorAll<HTMLElement>(
      `[data-comment-id="${CSS.escape(id)}"]`
    );
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
  // For multi-block comments every <span data-comment-id="..."> blinks.
  const handleJump = (c: CollectedComment) => {
    flashMark(c.id);
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
          Comments ({comments.length})
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
      <Box sx={{ flex: 1, overflow: "auto" }}>
        {comments.length === 0 ? (
          <Box sx={{ p: 2 }}>
            <Typography variant="body2" color="text.secondary">
              コメントはまだありません。テキストを選択して「コメント」を押すと追加できます。
            </Typography>
          </Box>
        ) : (
          comments.map((c) => (
            <Box
              key={c.id || `${c.from}-${c.to}`}
              role="button"
              tabIndex={0}
              onClick={() => handleJump(c)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleJump(c);
                }
              }}
              data-testid="comment-item"
              data-comment-id={c.id}
              sx={{
                p: 1.5,
                borderBottom: "1px solid",
                borderColor: "divider",
                cursor: "pointer",
                bgcolor: activeId === c.id ? "action.selected" : "transparent",
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
                {SCOPE_BADGE[c.scope] && (
                  <Chip
                    label={SCOPE_BADGE[c.scope].label}
                    size="small"
                    sx={{
                      height: 18,
                      fontSize: "0.65rem",
                      bgcolor: SCOPE_BADGE[c.scope].color,
                      "& .MuiChip-label": { px: 0.75 },
                    }}
                    data-testid={`comment-scope-${c.scope}`}
                  />
                )}
                <Typography variant="caption" color="text.secondary" sx={{ flexGrow: 1 }}>
                  {c.date || "?"}
                </Typography>
                <Tooltip title="コメントを削除">
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(c.id);
                    }}
                    aria-label="delete comment"
                    data-testid="comment-delete"
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
              {c.target && (
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
                  対象: {c.target}
                </Typography>
              )}
              <Typography
                variant="body2"
                sx={{
                  mt: 0.5,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {c.body}
              </Typography>
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
}
