import { useMemo, useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import FormControl from "@mui/material/FormControl";
import FormGroup from "@mui/material/FormGroup";
import RadioGroup from "@mui/material/RadioGroup";
import FormControlLabel from "@mui/material/FormControlLabel";
import Radio from "@mui/material/Radio";
import Checkbox from "@mui/material/Checkbox";

export type CommentDialogMode = "anchored" | "standalone";

export type CommentDialogScope =
  | "inline"
  | "block"
  | "cross-section"
  | "global";

export interface DialogHeading {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
}

interface ScopeChoice {
  value: CommentDialogScope;
  label: string;
  hint: string;
}

const ANCHORED_SCOPES: ReadonlyArray<ScopeChoice> = [
  { value: "inline", label: "inline", hint: "選択範囲だけに紐付ける（デフォルト）" },
  { value: "block", label: "block", hint: "段落単位の指摘" },
];

const STANDALONE_SCOPES: ReadonlyArray<ScopeChoice> = [
  { value: "global", label: "global", hint: "ファイル全体への指摘" },
  {
    value: "cross-section",
    label: "cross-section",
    hint: "複数の見出しに波及する指摘",
  },
];

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
  defaultScope?: CommentDialogScope;
  /** H1/H2 headings of the current document; required for cross-section. */
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

function DialogBody({
  mode = "anchored",
  targetSnippet,
  defaultBody,
  defaultScope,
  headings,
  onClose,
  onSubmit,
}: Props) {
  const availableHeadings = useMemo(
    () => (headings ?? []).filter((h) => h.text.length > 0),
    [headings]
  );
  const hasHeadings = availableHeadings.length > 0;

  const baseChoices = mode === "standalone" ? STANDALONE_SCOPES : ANCHORED_SCOPES;
  // Drop cross-section when the document has no H1/H2 headings to bind to.
  const choices = useMemo(
    () =>
      baseChoices.filter(
        (c) => c.value !== "cross-section" || hasHeadings || mode !== "standalone"
      ),
    [baseChoices, hasHeadings, mode]
  );
  const initialScope: CommentDialogScope =
    defaultScope && choices.some((c) => c.value === defaultScope)
      ? defaultScope
      : choices[0].value;

  const [body, setBody] = useState(defaultBody ?? "");
  const [scope, setScope] = useState<CommentDialogScope>(initialScope);
  const [selectedSections, setSelectedSections] = useState<string[]>([]);

  const trimmed = body.trim();
  const needsSections = mode === "standalone" && scope === "cross-section";
  const canSubmit =
    trimmed.length > 0 && (!needsSections || selectedSections.length > 0);
  const snippetPreview = targetSnippet.length
    ? truncate(targetSnippet, SNIPPET_LIMIT)
    : "(範囲が選択されていません)";

  const toggleSection = (text: string) => {
    setSelectedSections((prev) =>
      prev.includes(text) ? prev.filter((t) => t !== text) : [...prev, text]
    );
  };

  const submit = () => {
    if (!canSubmit) return;
    if (needsSections) {
      onSubmit({ body: trimmed, scope, sections: selectedSections });
    } else {
      onSubmit({ body: trimmed, scope });
    }
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
          {mode === "standalone" && !hasHeadings && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ mt: 0.5, display: "block" }}
              data-testid="comment-no-headings-hint"
            >
              `# ` または `## ` 見出しが無いため `cross-section` は選べません
            </Typography>
          )}
        </FormControl>
        {needsSections && (
          <Box sx={{ mb: 2 }} data-testid="comment-sections-picker">
            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5 }}>
              対象の見出し（1 つ以上選んでください）
            </Typography>
            <FormGroup
              sx={{
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
                          // Make the checkbox state easy to assert in tests.
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
                          // Mark H1 vs H2 visually.
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
