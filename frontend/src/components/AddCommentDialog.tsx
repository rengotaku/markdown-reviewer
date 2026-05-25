import { useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import FormControl from "@mui/material/FormControl";
import RadioGroup from "@mui/material/RadioGroup";
import FormControlLabel from "@mui/material/FormControlLabel";
import Radio from "@mui/material/Radio";

export type CommentDialogMode = "anchored" | "standalone";

export type CommentDialogScope =
  | "inline"
  | "block"
  | "cross-section"
  | "global";

const ANCHORED_SCOPES: ReadonlyArray<{
  value: CommentDialogScope;
  label: string;
  hint: string;
}> = [
  { value: "inline", label: "inline", hint: "選択範囲だけに紐付ける（デフォルト）" },
  { value: "block", label: "block", hint: "段落単位の指摘" },
];

const STANDALONE_SCOPES: ReadonlyArray<{
  value: CommentDialogScope;
  label: string;
  hint: string;
}> = [
  { value: "global", label: "global", hint: "ファイル全体への指摘" },
  {
    value: "cross-section",
    label: "cross-section",
    hint: "複数セクションに波及する指摘",
  },
];

interface Props {
  open: boolean;
  mode?: CommentDialogMode;
  targetSnippet: string;
  defaultBody?: string;
  defaultScope?: CommentDialogScope;
  onClose: () => void;
  onSubmit: (input: { body: string; scope: CommentDialogScope }) => void;
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
  mode = "anchored",
  targetSnippet,
  defaultBody,
  defaultScope,
  onClose,
  onSubmit,
}: Props) {
  const choices = mode === "standalone" ? STANDALONE_SCOPES : ANCHORED_SCOPES;
  const initialScope: CommentDialogScope =
    defaultScope && choices.some((c) => c.value === defaultScope)
      ? defaultScope
      : choices[0].value;

  const [body, setBody] = useState(defaultBody ?? "");
  const [scope, setScope] = useState<CommentDialogScope>(initialScope);

  const trimmed = body.trim();
  const canSubmit = trimmed.length > 0;
  const snippetPreview = targetSnippet.length
    ? truncate(targetSnippet, SNIPPET_LIMIT)
    : "(範囲が選択されていません)";

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({ body: trimmed, scope });
  };

  return (
    <>
      <DialogTitle>
        {mode === "standalone" ? "横断 / 全体コメントを追加" : "コメントを追加"}
      </DialogTitle>
      <DialogContent>
        {mode === "anchored" && (
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
        )}
        <FormControl sx={{ mb: 2 }} component="fieldset" data-testid="comment-scope-group">
          <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5 }}>
            スコープ
          </Typography>
          <RadioGroup
            row
            value={scope}
            onChange={(e) => setScope(e.target.value as CommentDialogScope)}
          >
            {choices.map((c) => (
              <FormControlLabel
                key={c.value}
                value={c.value}
                control={
                  <Radio
                    size="small"
                    inputProps={{
                      // Per-option test hook for picking a specific scope.
                      "data-testid": `comment-scope-radio-${c.value}`,
                    } as React.InputHTMLAttributes<HTMLInputElement>}
                  />
                }
                label={
                  <Box>
                    <Typography variant="body2" component="span">
                      {c.label}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ ml: 1 }}
                    >
                      {c.hint}
                    </Typography>
                  </Box>
                }
              />
            ))}
          </RadioGroup>
        </FormControl>
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
