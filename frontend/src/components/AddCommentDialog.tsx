import { useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";

interface Props {
  open: boolean;
  targetSnippet: string;
  defaultBody?: string;
  onClose: () => void;
  onSubmit: (input: { body: string }) => void;
}

const SNIPPET_LIMIT = 80;

export function AddCommentDialog(props: Props) {
  // Re-mount the form whenever the dialog re-opens so state resets cleanly
  // without an effect-driven setState.
  return (
    <Dialog open={props.open} onClose={props.onClose} fullWidth maxWidth="sm">
      {props.open ? <DialogBody {...props} /> : null}
    </Dialog>
  );
}

function DialogBody({
  targetSnippet,
  defaultBody,
  onClose,
  onSubmit,
}: Props) {
  const [body, setBody] = useState(defaultBody ?? "");

  const trimmed = body.trim();
  const canSubmit = trimmed.length > 0;
  const snippetPreview = targetSnippet.length
    ? truncate(targetSnippet, SNIPPET_LIMIT)
    : "(範囲が選択されていません)";

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({ body: trimmed });
  };

  return (
    <>
      <DialogTitle>コメントを追加</DialogTitle>
      <DialogContent>
        <Box sx={{ mb: 2 }}>
          <Typography variant="caption" color="text.secondary">
            対象テキスト
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
