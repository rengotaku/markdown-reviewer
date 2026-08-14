import { useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import { useConfirm } from "@/hooks/useConfirm";

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
 *   - "edit"          → rewrites an existing comment's body, seeded with
 *                       `defaultBody`. Triggered from the marker's right-click
 *                       menu. The scope is already fixed, so none is emitted.
 */
export type CommentDialogMode = "anchored" | "block" | "global" | "edit";

export type CommentDialogScope = "inline" | "block" | "global";

export interface CommentDialogSubmit {
  body: string;
  /** Absent in "edit" mode: the comment's scope was decided when it was
   *  created and this dialog never changes it. */
  scope?: CommentDialogScope;
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
  const { open, defaultBody, onClose } = props;
  const confirm = useConfirm((s) => s.confirm);

  // Body lives here (not in DialogBody) so both the backdrop/Escape close
  // path (Dialog's onClose, below) and the cancel button can check it before
  // deciding whether to discard-confirm. Reset it every time the dialog
  // opens — reopening with a fresh (or new default) body is the existing,
  // intentional behavior we're preserving.
  //
  // This uses React's "adjusting state when a prop changes" render-time
  // pattern (see https://react.dev/learn/you-might-not-need-an-effect)
  // instead of an effect: an effect would re-seed the body *after* the
  // already-open dialog re-renders, which both flashes the stale value and
  // trips react-hooks/set-state-in-effect. Tracking the previous `open`
  // value and updating `body` inline during render bails out before commit,
  // so React never paints the stale state.
  const [body, setBody] = useState(defaultBody ?? "");
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setBody(defaultBody ?? "");
    }
  }

  const requestClose = async () => {
    // Confirm only when there is unsaved work — i.e. the body differs from what
    // the dialog opened with. For a new comment that baseline is empty (the
    // original "is the body non-empty" check); when editing, `defaultBody` is
    // non-empty from the start, so comparing against it keeps an untouched
    // cancel from prompting.
    if (body.trim() === (defaultBody ?? "").trim()) {
      onClose();
      return;
    }
    const ok = await confirm({
      title: "コメントを破棄しますか？",
      message: "入力中のコメントは保存されません。",
      confirmLabel: "破棄する",
      cancelLabel: "編集を続ける",
    });
    if (ok) {
      onClose();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={requestClose}
      fullWidth
      maxWidth="sm"
      // MUI Dialog restores focus to the trigger element (the editor's
      // contenteditable) on close. The browser then scrolls the caret into
      // view — and the caret may still be at doc start if the user opened
      // the file but never clicked into the editor — yanking the viewport
      // to the top. Suppress the restore to keep the view stable.
      disableRestoreFocus
    >
      {open ? (
        <DialogBody
          {...props}
          body={body}
          setBody={setBody}
          onClose={requestClose}
        />
      ) : null}
    </Dialog>
  );
}

function dialogTitle(mode: CommentDialogMode): string {
  switch (mode) {
    case "global":
      return "全体コメントを追加";
    case "block":
      return "ブロックにコメントを追加";
    case "edit":
      return "コメントを編集";
    default:
      return "コメントを追加";
  }
}

function targetLabel(mode: CommentDialogMode): string {
  return mode === "block" ? "対象ブロック" : "対象テキスト";
}

function submitLabel(mode: CommentDialogMode): string {
  return mode === "edit" ? "保存" : "追加";
}

interface DialogBodyProps extends Props {
  body: string;
  setBody: (body: string) => void;
}

function DialogBody({
  mode = "anchored",
  targetSnippet,
  body,
  setBody,
  onClose,
  onSubmit,
}: DialogBodyProps) {
  const trimmed = body.trim();
  const showTarget = mode !== "global";
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
      case "edit":
        onSubmit({ body: trimmed });
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
          // MUI zeroes DialogContent's padding-top when it follows a
          // DialogTitle, and an outlined label is painted above the input's
          // top border — so as the first child (global mode, where no target
          // preview precedes it) the label lands in the title's space and is
          // clipped by the content box. Reserve the room on the field itself:
          // a `pt` on DialogContent loses to MUI's compound selector.
          sx={{ mt: 1.5 }}
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
          {submitLabel(mode)}
        </Button>
      </DialogActions>
    </>
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}
