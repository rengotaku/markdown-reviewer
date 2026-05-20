import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { Editor } from "@tiptap/react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { collectComments, type CollectedComment } from "@/utils/collectComments";

interface Props {
  editor: Editor | null;
  onDelete: (id: string) => void;
  activeId?: string | null;
}

interface CommentSnapshot {
  comments: CollectedComment[];
  fingerprint: string;
}

const EMPTY_SNAPSHOT: CommentSnapshot = { comments: [], fingerprint: "" };

function fingerprintOf(comments: CollectedComment[]): string {
  return comments
    .map((c) => `${c.id}|${c.from}|${c.to}|${c.body}|${c.target}`)
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

export function CommentSidePane({ editor, onDelete, activeId }: Props) {
  const comments = useEditorComments(editor);

  const flashMark = (id: string) => {
    if (!id) return;
    const root = editor?.view?.dom;
    if (!root) return;
    const nodes = root.querySelectorAll<HTMLElement>(
      `[data-comment-id="${CSS.escape(id)}"]`
    );
    nodes.forEach((el) => {
      // Restart animation if already flashing.
      el.classList.remove("is-flash");
      void el.offsetWidth;
      el.classList.add("is-flash");
    });
    window.setTimeout(() => {
      nodes.forEach((el) => el.classList.remove("is-flash"));
    }, 1600);
  };

  const handleJump = (c: CollectedComment) => {
    if (!editor) return;
    editor
      .chain()
      .focus()
      .setTextSelection({ from: c.from, to: c.to })
      .scrollIntoView()
      .run();
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
          p: 1.5,
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
