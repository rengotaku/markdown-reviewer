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
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";

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
 *   - "cross-section" → bind to a chosen set of headings (H1..H6; the dialog
 *                       picker defaults to H1+H2 with a toggle to expand).
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
  /**
   * Document position of the heading node (the value yielded by
   * `editor.state.doc.descendants` for the heading itself). Used by the
   * caller to anchor cross-section markers to specific section positions
   * so duplicate-named headings stay distinguishable.
   */
  pos?: number;
}

export interface CommentDialogSelectedHeading {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  pos: number;
}

export interface CommentDialogSubmit {
  body: string;
  scope: CommentDialogScope;
  /**
   * Headings selected in the cross-section picker, in document order.
   * Only present when scope = "cross-section". Carries the heading position
   * so the caller can anchor one block-scope marker per heading.
   */
  selectedHeadings?: ReadonlyArray<CommentDialogSelectedHeading>;
}

interface Props {
  open: boolean;
  mode?: CommentDialogMode;
  targetSnippet: string;
  defaultBody?: string;
  /** All headings (H1..H6) of the current document; used only when mode = "cross-section". The picker filters them by the user-controlled max level. */
  headings?: ReadonlyArray<DialogHeading>;
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
  // Pin each heading to its original index so rows with duplicate text can
  // be selected independently (the picker key is the index, not the text).
  const availableHeadings = useMemo(
    () =>
      (headings ?? [])
        .map((h, idx) => ({ ...h, idx }))
        .filter((h) => h.text.length > 0),
    [headings]
  );
  const levelCounts = useMemo(() => {
    const m = new Map<number, number>();
    for (const h of availableHeadings) {
      m.set(h.level, (m.get(h.level) ?? 0) + 1);
    }
    return m;
  }, [availableHeadings]);
  const hasAnyHeadings = availableHeadings.length > 0;

  const [body, setBody] = useState(defaultBody ?? "");
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  // Default range covers h1+h2. User can extend up to h6 via the toggle group.
  const [maxLevel, setMaxLevel] = useState<1 | 2 | 3 | 4 | 5 | 6>(2);

  const visibleHeadings = useMemo(
    () => availableHeadings.filter((h) => h.level <= maxLevel),
    [availableHeadings, maxLevel]
  );
  const hasVisibleHeadings = visibleHeadings.length > 0;

  const trimmed = body.trim();
  const isCrossSection = mode === "cross-section";
  const showTarget = mode === "anchored" || mode === "block";
  const canSubmit =
    trimmed.length > 0 &&
    (!isCrossSection || selectedIndices.length > 0);

  const snippetPreview = targetSnippet.length
    ? truncate(targetSnippet, SNIPPET_LIMIT)
    : "(対象が指定されていません)";

  const toggleSection = (idx: number) => {
    setSelectedIndices((prev) =>
      prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
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
      case "cross-section": {
        // Return the selected headings (with their doc positions) in document
        // order. The caller anchors one block-scope marker per heading using
        // these positions — that's how same-named sections stay distinguishable.
        const sortedIndices = [...selectedIndices].sort((a, b) => a - b);
        const byIdx = new Map(availableHeadings.map((h) => [h.idx, h]));
        const selectedHeadings: CommentDialogSelectedHeading[] = [];
        for (const i of sortedIndices) {
          const h = byIdx.get(i);
          if (!h || typeof h.pos !== "number") continue;
          selectedHeadings.push({ level: h.level, text: h.text, pos: h.pos });
        }
        onSubmit({
          body: trimmed,
          scope: "cross-section",
          selectedHeadings,
        });
        return;
      }
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
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ mb: 0.5, display: "block" }}
            >
              対象の見出し（デフォルトは <code>#</code> / <code>##</code>。下のボタンで <code>######</code> まで広げられます。1 つ以上選んでください）
            </Typography>
            <Box sx={{ mb: 1 }}>
              <ToggleButtonGroup
                value={maxLevel}
                exclusive
                size="small"
                onChange={(_, v) => {
                  if (v !== null) setMaxLevel(v as 1 | 2 | 3 | 4 | 5 | 6);
                }}
                aria-label="表示する見出しの最大レベル"
                data-testid="comment-max-level"
              >
                {([1, 2, 3, 4, 5, 6] as const).map((l) => (
                  <ToggleButton
                    key={l}
                    value={l}
                    sx={{ px: 1.25, py: 0.25, textTransform: "none" }}
                    data-testid={`comment-max-level-${l}`}
                  >
                    <Typography
                      variant="caption"
                      sx={{ fontFamily: "monospace", lineHeight: 1.2 }}
                    >
                      h{l}
                      <Box
                        component="span"
                        sx={{ ml: 0.5, opacity: 0.6, fontSize: "0.7rem" }}
                      >
                        ({levelCounts.get(l) ?? 0})
                      </Box>
                    </Typography>
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Box>
            {hasAnyHeadings ? (
              hasVisibleHeadings ? (
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
                  {visibleHeadings.map((h) => {
                    const id = `comment-section-${h.idx}`;
                    const checked = selectedIndices.includes(h.idx);
                    return (
                      <FormControlLabel
                        key={`${h.level}:${h.idx}`}
                        sx={{ py: 0 }}
                        control={
                          <Checkbox
                            size="small"
                            checked={checked}
                            onChange={() => toggleSection(h.idx)}
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
                  data-testid="comment-no-visible-headings-hint"
                  sx={{ display: "block" }}
                >
                  現在の範囲（h1〜h{maxLevel}）に該当する見出しがありません。上のボタンで範囲を広げてください。
                </Typography>
              )
            ) : (
              <Typography
                variant="caption"
                color="text.secondary"
                data-testid="comment-no-headings-hint"
              >
                見出しが見つかりませんでした。先に見出しを追加してください。
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
