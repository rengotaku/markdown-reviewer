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
  /** Body being typed. Lifted out so the caller can refuse to discard it. */
  draft: string;
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
  draft,
  onDraftChange,
  onSubmit,
  onCancel,
}: Props) {
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
        width: 352,
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
            p: 1,
            bgcolor: "action.hover",
            borderRadius: 1,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            // The quoted target is context, not the thing being written.
            color: "text.secondary",
            minHeight: 0,
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
        onChange={(e) => onDraftChange(e.target.value)}
        onKeyDown={(e) => {
          // Enter alone stays a newline: these bodies are Markdown.
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
        inputProps={{ "data-testid": "comment-body-input" }}
      />

      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
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
