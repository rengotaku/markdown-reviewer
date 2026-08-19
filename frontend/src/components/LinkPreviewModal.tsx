import { useEffect, useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import { readFile } from "@/api";
import { stripHint } from "@/utils/stripHint";
import { splitPreamble } from "@/utils/frontmatter";
import { renderCommentMarkdown } from "@/utils/commentMarkdown";
import { markdownBodySx } from "./markdownBodySx";

interface Props {
  open: boolean;
  /** Root-relative path of the file to preview. Empty while nothing is
   *  requested — the dialog stays closed in that case regardless of `open`. */
  path: string;
  root: string;
  onClose: () => void;
  onOpen: (path: string) => void;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; html: string };

/**
 * LinkPreviewModal shows a read-only preview of an internal link's target
 * (#213) so hovering a `[text](./sibling.md)` link doesn't require opening a
 * tab just to see what it points at.
 *
 * Content is fetched fresh on every open — there's no cache, since the
 * target file's on-disk content can change between hovers and this is a
 * short-lived, read-only glance rather than something worth keeping in sync.
 */
export function LinkPreviewModal({ open, path, root, onClose, onOpen }: Props) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    if (!open || !path) return;
    let cancelled = false;
    // Reset to loading whenever `open`/`path` changes — the classic
    // fetch-on-prop-change effect. `react-hooks/set-state-in-effect` flags
    // this as a possible cascading render, but there is no way to derive
    // "loading" from props/state without an effect (the fetch itself must
    // start here), so this is the intended pattern rather than a bug.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ status: "loading" });
    readFile(path, root)
      .then((res) => {
        if (cancelled) return;
        const body = splitPreamble(stripHint(res.content)).body;
        setState({ status: "ready", html: renderCommentMarkdown(body) });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          message: (err as Error).message ?? "unknown error",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [open, path, root]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      aria-labelledby="link-preview-title"
    >
      <DialogTitle id="link-preview-title" sx={{ wordBreak: "break-all" }}>
        {path}
      </DialogTitle>
      <DialogContent
        sx={{
          maxHeight: "60vh",
          overflowY: "auto",
        }}
      >
        {state.status === "loading" && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
            <CircularProgress size={28} />
          </Box>
        )}
        {state.status === "error" && (
          <Typography color="error" data-testid="link-preview-error">
            プレビューを読み込めませんでした: {state.message}
          </Typography>
        )}
        {state.status === "ready" && (
          <Box
            data-testid="link-preview-content"
            // Same rendering path + compact-article styling as
            // CommentSidePane's comment bodies (markdownBodySx, #213):
            // renderCommentMarkdown escapes raw HTML (html: false), so this
            // is as safe as any other Markdown-derived preview in the app.
            sx={[{ wordBreak: "break-word" }, markdownBodySx]}
            dangerouslySetInnerHTML={{ __html: state.html }}
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>閉じる</Button>
        <Button
          variant="contained"
          onClick={() => onOpen(path)}
          disabled={state.status !== "ready"}
          data-testid="link-preview-open"
        >
          開く
        </Button>
      </DialogActions>
    </Dialog>
  );
}
