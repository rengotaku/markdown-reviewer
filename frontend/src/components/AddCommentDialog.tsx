import { useMemo, useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import FormGroup from "@mui/material/FormGroup";
import FormControlLabel from "@mui/material/FormControlLabel";
import Checkbox from "@mui/material/Checkbox";

/**
 * The dialog supports four discrete flows; the caller picks which by setting
 * `mode`, and the dialog renders only the inputs that flow needs. No scope
 * radio is shown — the scope is implied by which entry point opened the
 * dialog.
 *
 *   - "anchored"      → wraps the active selection (scope=inline)
 *   - "block"         → wraps an entire block (scope=block).
 *                       Triggered from the drag-handle context menu.
 *   - "global"        → file-wide comment. Body only.
 *   - "cross-section" → bind to a chosen set of H1/H2 headings.
 */
export type CommentDialogMode =
  | "anchored"
  | "block"
  | "global"
  | "cross-section";

export type CommentDialogScope =
  | "inline"
  | "block"
  | "cross-section"
  | "global";

export interface DialogHeading {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
}

export interface CommentDialogSubmit {
  body: string;
  scope: CommentDialogScope;
  /** Selected H1/H2 titles when scope = "cross-section". */
  sections?: string[];
}

interface Props {
  open: boolean;
  mode?: CommentDialogMode;
  targetSnippet: string;
  defaultBody?: string;
  /** H1/H2 headings of the current document; used only when mode = "cross-section". */
  headings?: ReadonlyArray<DialogHeading>;
  onClose: () => void;
  onSubmit: (input: CommentDialogSubmit) => void;
}

const SNIPPET_LIMIT = 80;

export function AddCommentDialog(props: Props) {
  return (
    <Dialog open={props.open} onClose={props.onClose} fullWidth maxWidth="sm">
      {props.open ? <DialogBody {...props} /> : null}
    </Dialog>
  );
}

function dialogTitle(mode: CommentDialogMode): string {
  switch (mode) {
    case "global":
      return "全体コメントを追加";
    case "cross-section":
      return "横断コメントを追加";
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
  headings,
  onClose,
  onSubmit,
}: Props) {
  const availableHeadings = useMemo(
    () => (headings ?? []).filter((h) => h.text.length > 0),
    [headings]
  );
  const hasHeadings = availableHeadings.length > 0;

  const [body, setBody] = useState(defaultBody ?? "");
  const [selectedSections, setSelectedSections] = useState<string[]>([]);

  const trimmed = body.trim();
  const isCrossSection = mode === "cross-section";
  const showTarget = mode === "anchored" || mode === "block";
  const canSubmit =
    trimmed.length > 0 &&
    (!isCrossSection || selectedSections.length > 0);

  const snippetPreview = targetSnippet.length
    ? truncate(targetSnippet, SNIPPET_LIMIT)
    : "(対象が指定されていません)";

  const toggleSection = (text: string) => {
    setSelectedSections((prev) =>
      prev.includes(text) ? prev.filter((t) => t !== text) : [...prev, text]
    );
  };

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
      case "cross-section":
        onSubmit({
          body: trimmed,
          scope: "cross-section",
          sections: selectedSections,
        });
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
        {isCrossSection && (
          <Box sx={{ mb: 2 }} data-testid="comment-sections-picker">
            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5 }}>
              対象の見出し（1 つ以上選んでください）
            </Typography>
            {hasHeadings ? (
              <FormGroup
                sx={{
                  // MUI FormGroup defaults to flex-wrap: wrap which, combined
                  // with a constrained height, causes items to wrap into a
                  // second column instead of scrolling vertically. Force a
                  // single column and let overflow scroll handle the rest.
                  flexWrap: "nowrap",
                  maxHeight: 220,
                  overflow: "auto",
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: 1,
                  px: 1,
                  py: 0.5,
                }}
              >
                {availableHeadings.map((h, idx) => {
                  const id = `comment-section-${idx}`;
                  const checked = selectedSections.includes(h.text);
                  return (
                    <FormControlLabel
                      key={`${h.level}:${h.text}:${idx}`}
                      sx={{ py: 0 }}
                      control={
                        <Checkbox
                          size="small"
                          checked={checked}
                          onChange={() => toggleSection(h.text)}
                          inputProps={{
                            "data-testid": id,
                            "aria-label": h.text,
                          } as React.InputHTMLAttributes<HTMLInputElement>}
                        />
                      }
                      label={
                        <Typography
                          variant="body2"
                          sx={{
                            fontFamily: "monospace",
                            fontSize: "0.8125rem",
                            fontWeight: h.level === 1 ? 600 : 400,
                            color:
                              h.level === 1 ? "text.primary" : "text.secondary",
                          }}
                        >
                          {"#".repeat(h.level)} {h.text}
                        </Typography>
                      }
                    />
                  );
                })}
              </FormGroup>
            ) : (
              <Typography
                variant="caption"
                color="text.secondary"
                data-testid="comment-no-headings-hint"
              >
                `# ` または `## ` 見出しが見つかりませんでした。先に見出しを追加してください。
              </Typography>
            )}
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
