import { useEffect, useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";

const SCOPE_LABEL: Record<string, string> = {
  inline: "インライン",
  block: "ブロック",
  "cross-section": "横断",
  global: "全体",
};

const TARGET_LIMIT = 120;

interface Props {
  open: boolean;
  scope: string;
  target: string;
  defaultBody: string;
  onClose: () => void;
  onSubmit: (body: string) => void;
}

/**
 * Body-only editor for an existing comment. Scope, target, and grouping are
 * immutable here — recreating those means deleting and re-adding the comment.
 */
export function EditCommentDialog(props: Props) {
  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      fullWidth
      maxWidth="sm"
      // MUI Dialog restores focus to the element that triggered it (the
      // editor's contenteditable). Browsers scroll the caret into view on
      // focus, which jumps the viewport — usually to wherever the caret
      // happened to be sitting (often the doc start). Suppress the restore
      // so the viewport stays put after Save / Cancel.
      disableRestoreFocus
    >
      {props.open ? <DialogBody {...props} /> : null}
    </Dialog>
  );
}

function DialogBody({
  scope,
  target,
  defaultBody,
  onClose,
  onSubmit,
}: Props) {
  const [body, setBody] = useState(defaultBody);

  // Sync when the caller swaps the comment under us without closing.
  useEffect(() => {
    setBody(defaultBody);
  }, [defaultBody]);

  const trimmed = body.trim();
  const canSubmit = trimmed.length > 0 && trimmed !== defaultBody.trim();
  const submit = () => {
    if (!canSubmit) return;
    onSubmit(trimmed);
  };

  const scopeLabel = SCOPE_LABEL[scope] ?? scope;
  const targetPreview = target.length
    ? target.length > TARGET_LIMIT
      ? `${target.slice(0, TARGET_LIMIT)}…`
      : target
    : "";

  return (
    <>
      <DialogTitle>コメントを編集（{scopeLabel}）</DialogTitle>
      <DialogContent>
        {targetPreview && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="caption" color="text.secondary">
              対象
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
              data-testid="edit-comment-target"
            >
              {targetPreview}
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
          inputProps={{ "data-testid": "edit-comment-body-input" }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>キャンセル</Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={!canSubmit}
          data-testid="edit-comment-submit"
        >
          保存
        </Button>
      </DialogActions>
    </>
  );
}
