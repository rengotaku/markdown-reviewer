import { useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";

/**
 * The dialog supports three discrete flows; the caller picks which by setting
 * `mode`, and the dialog renders only the inputs that flow needs. No scope
 * radio is shown — the scope is implied by which entry point opened the
 * dialog.
 *
 *   - "anchored"      → wraps the active selection (scope=inline)
 *   - "block"         → wraps an entire block (scope=block).
 *                       Triggered from the drag-handle context menu.
 *   - "global"        → file-wide comment. Body only.
 */
export type CommentDialogMode = "anchored" | "block" | "global";

export type CommentDialogScope = "inline" | "block" | "global";

export interface CommentDialogSubmit {
  body: string;
  scope: CommentDialogScope;
}

interface Props {
  open: boolean;
  mode?: CommentDialogMode;
  targetSnippet: string;
  defaultBody?: string;
  onClose: () => void;
  onSubmit: (input: CommentDialogSubmit) => void;
}

const SNIPPET_LIMIT = 80;

export function AddCommentDialog(props: Props) {
  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      fullWidth
      maxWidth="sm"
      // MUI Dialog restores focus to the trigger element (the editor's
      // contenteditable) on close. The browser then scrolls the caret into
      // view — and the caret may still be at doc start if the user opened
      // the file but never clicked into the editor — yanking the viewport
      // to the top. Suppress the restore to keep the view stable.
      disableRestoreFocus
    >
      {props.open ? <DialogBody {...props} /> : null}
    </Dialog>
  );
}

function dialogTitle(mode: CommentDialogMode): string {
  switch (mode) {
    case "global":
      return "全体コメントを追加";
    case "block":
      return "ブロックにコメントを追加";
    default:
      return "コメントを追加";
  }
}

function targetLabel(mode: CommentDialogMode): string {
  return mode === "block" ? "対象ブロック" : "対象テキスト";
}

function DialogBody({
  mode = "anchored",
  targetSnippet,
  defaultBody,
  onClose,
  onSubmit,
}: Props) {
  const [body, setBody] = useState(defaultBody ?? "");

  const trimmed = body.trim();
  const showTarget = mode === "anchored" || mode === "block";
  const canSubmit = trimmed.length > 0;

  const snippetPreview = targetSnippet.length
    ? truncate(targetSnippet, SNIPPET_LIMIT)
    : "(対象が指定されていません)";

  const submit = () => {
    if (!canSubmit) return;
    switch (mode) {
      case "anchored":
        onSubmit({ body: trimmed, scope: "inline" });
        return;
      case "block":
        onSubmit({ body: trimmed, scope: "block" });
        return;
      case "global":
        onSubmit({ body: trimmed, scope: "global" });
        return;
    }
  };

  return (
    <>
      <DialogTitle>{dialogTitle(mode)}</DialogTitle>
      <DialogContent>
        {showTarget && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="caption" color="text.secondary">
              {targetLabel(mode)}
            </Typography>
            <Typography
              variant="body2"
              sx={{
                mt: 0.5,
                p: 1,
                bgcolor: "grey.100",
                borderRadius: 1,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
              data-testid="comment-target-snippet"
            >
              {snippetPreview}
            </Typography>
          </Box>
        )}
        <TextField
          label="コメント本文"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          multiline
          minRows={3}
          fullWidth
          autoFocus
          inputProps={{ "data-testid": "comment-body-input" }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>キャンセル</Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={!canSubmit}
          data-testid="comment-submit"
        >
          追加
        </Button>
      </DialogActions>
    </>
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}
