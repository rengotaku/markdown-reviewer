import { useState } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

/**
 * Which flow opened the composer. The scope is implied by the entry point —
 * there is no scope picker — and "edit" carries no scope at all, because a
 * comment's scope is fixed when it is created.
 *
 *   - "anchored" → wraps the active selection (scope=inline)
 *   - "global"   → file-wide comment, body only
 *   - "edit"     → rewrites an existing comment's body
 */
export type ComposerMode = "anchored" | "global" | "edit";

export type ComposerScope = "inline" | "global";

export interface ComposerSubmit {
  body: string;
  /** Absent in "edit" mode. */
  scope?: ComposerScope;
}

const SNIPPET_LIMIT = 80;

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

function title(mode: ComposerMode): string {
  switch (mode) {
    case "global":
      return "全体コメント";
    case "edit":
      return "コメントを編集";
    default:
      return "選択範囲にコメント";
  }
}

interface Props {
  mode: ComposerMode;
  /** The text the comment will hang off. Empty in "global" mode. */
  targetSnippet: string;
  /** Ceiling in px, computed by the caller from the room around the anchor. */
  maxHeight: number;
  /** Body the field starts with. The composer owns the text from there on
   *  (#357: keeping it in the caller re-rendered the whole editor per
   *  keystroke); remount it with a new `key` to start over. */
  initialDraft: string;
  /** Reports every change, so the caller can refuse to discard unsent text. */
  onDraftChange: (next: string) => void;
  onSubmit: (input: ComposerSubmit) => void;
  onCancel: () => void;
}

/** Writing surface for a new or edited comment (#252). It replaces the centre
 *  modal the editor used to open: replies are written beside the text they
 *  answer (#251), and a new comment had no reason to be the one place that
 *  covered the document to ask for a sentence. */
export function CommentComposerPopover({
  mode,
  targetSnippet,
  maxHeight,
  initialDraft,
  onDraftChange,
  onSubmit,
  onCancel,
}: Props) {
  const [draft, setDraft] = useState(initialDraft);
  const trimmed = draft.trim();
  const canSubmit = trimmed.length > 0;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit(
      mode === "edit"
        ? { body: trimmed }
        : { body: trimmed, scope: mode === "global" ? "global" : "inline" }
    );
  };

  return (
    <Paper
      elevation={6}
      data-testid="comment-composer-popover"
      sx={{
        // #355: 1.5x the original 352px, so a pasted log wraps less. Capped
        // to the viewport so a narrow window still shows the whole frame.
        width: 528,
        maxWidth: "calc(100vw - 16px)",
        maxHeight,
        overflow: "hidden",
        p: 1.5,
        display: "flex",
        flexDirection: "column",
        gap: 1,
      }}
    >
      <Typography variant="caption" color="text.disabled">
        {title(mode)}
      </Typography>

      {mode !== "global" && targetSnippet && (
        <Typography
          variant="body2"
          data-testid="comment-target-snippet"
          sx={{
            px: 1,
            // Vertical spacing as a transparent border, not padding: a
            // scroller clips at its padding box, so padding would let a third
            // line peek in half-cut below the two that fit. The border sits
            // outside the clip and the background still paints under it.
            borderBlock: "8px solid transparent",
            bgcolor: "action.hover",
            borderRadius: 1,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            // The quoted target is context, not the thing being written.
            color: "text.secondary",
            // #355: the quote takes at most two lines and scrolls past that,
            // leaving the rest of the frame to the body being written. It
            // keeps those two lines when the body grows instead of being
            // squeezed to a sliver by the flex column.
            flexShrink: 0,
            maxHeight: "calc(2lh + 16px)",
            overflow: "auto",
          }}
        >
          {truncate(targetSnippet, SNIPPET_LIMIT)}
        </Typography>
      )}

      <TextField
        autoFocus
        multiline
        minRows={3}
        fullWidth
        size="small"
        placeholder="コメントを書く…"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          onDraftChange(e.target.value);
        }}
        onKeyDown={(e) => {
          // Enter alone stays a newline: these bodies are Markdown.
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
        inputProps={{ "data-testid": "comment-body-input" }}
        // #355: the field grows with what's typed or pasted, and the Paper
        // clips at `maxHeight` — a pasted terminal log used to push the
        // buttons below the clip, out of reach. Every level down to the
        // textarea may shrink below its content (minHeight: 0), so the field
        // stops at the room left over and the text scrolls inside its own
        // outline: the buttons stay visible and the outline keeps all four
        // edges.
        sx={{
          flex: "1 1 auto",
          minHeight: 0,
          "& .MuiInputBase-root": {
            flex: "1 1 auto",
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          },
          "& .MuiInputBase-inputMultiline": {
            // #387: the size the posted body is shown at, not body1.
            typography: "body2",
            flex: "1 1 auto",
            minHeight: 0,
            overflow: "auto !important",
          },
        }}
      />

      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexShrink: 0 }}>
        <Button
          size="small"
          variant="contained"
          disabled={!canSubmit}
          onClick={submit}
          data-testid="comment-submit"
        >
          {mode === "edit" ? "保存" : "コメント"}
        </Button>
        <Button size="small" color="inherit" onClick={onCancel}>
          キャンセル
        </Button>
      </Box>
    </Paper>
  );
}
