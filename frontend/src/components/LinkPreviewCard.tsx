import { useEffect, useState } from "react";
import type { MouseEvent } from "react";
import Popper from "@mui/material/Popper";
import Paper from "@mui/material/Paper";
import IconButton from "@mui/material/IconButton";
import CloseIcon from "@mui/icons-material/Close";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import { readFile } from "@/api";
import { stripHint } from "@/utils/stripHint";
import { splitPreamble } from "@/utils/frontmatter";
import { renderCommentMarkdown } from "@/utils/commentMarkdown";
import { resolveInternalLink } from "@/utils/internalLink";
import { markdownBodySx } from "./markdownBodySx";

interface Props {
  open: boolean;
  /** Element the card is positioned against (the hovered `<a>`). `null`
   *  while nothing is being previewed — the Popper stays unmounted then,
   *  regardless of `open`. */
  anchorEl: Element | null;
  /** Root-relative path of the file to preview. Empty while nothing is
   *  requested — the card stays closed in that case regardless of `open`. */
  path: string;
  root: string;
  onClose: () => void;
  onOpen: (path: string) => void;
  /** Pointer entered the card itself — part of the hover stay area (#215):
   *  the card must stay open while the pointer is over either the link or
   *  the card, see linkHoverGuard.ts. */
  onMouseEnter: () => void;
  /** Pointer left the card — the other half of the stay area above. */
  onMouseLeave: () => void;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; html: string };

// Placement candidates tried in order until one fits the viewport — MUI's
// Popper (via popper.js's `flip` modifier) reorders through this list, so a
// link near the bottom/right edge gets a card that opens upward/leftward
// instead of running off-screen.
const POPPER_MODIFIERS = [
  { name: "flip", enabled: true },
  { name: "preventOverflow", enabled: true, options: { padding: 8 } },
  { name: "offset", options: { offset: [0, 8] } },
];

/**
 * LinkPreviewCard shows a read-only, non-modal preview of an internal
 * link's target (#213, hover-card follow-up #215) so hovering a
 * `[text](./sibling.md)` link doesn't require opening a tab just to see
 * what it points at. Unlike a modal, it never covers the rest of the
 * editor with a backdrop and the pointer can move freely between the link
 * and the card without closing it (see linkHoverGuard.ts's stay area).
 *
 * Content is fetched fresh on every open — there's no cache, since the
 * target file's on-disk content can change between hovers and this is a
 * short-lived, read-only glance rather than something worth keeping in sync.
 */
export function LinkPreviewCard({
  open,
  anchorEl,
  path,
  root,
  onClose,
  onOpen,
  onMouseEnter,
  onMouseLeave,
}: Props) {
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
        setState({ status: "ready", html: renderCommentMarkdown(body, path) });
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

  // Esc closes the card even though it isn't a modal (no backdrop click to
  // rely on). Only listens while open, and only on the actual card, so it
  // doesn't steal Esc from unrelated editor shortcuts.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const shown = open && !!anchorEl && !!path;

  // Links inside the preview body are plain HTML (dangerouslySetInnerHTML),
  // unlike the editor's own body — TipTap intercepts anchor clicks itself,
  // but nothing does that here, so a bare `<a href="../index.md">` would
  // otherwise fall through to a real browser navigation and land on the
  // SPA's 404 page (the URL doesn't match any client route). Handling the
  // click on the container (rather than per-anchor) mirrors
  // TiptapEditor.tsx's single-listener approach and needs no changes to the
  // rendered HTML string itself.
  const handleContentClick = (e: MouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as HTMLElement).closest("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    if (!href) return;

    // In-page anchors (`#heading`): never navigate, and there's no
    // in-preview jump target to scroll to, so just swallow the click.
    if (href.startsWith("#")) {
      e.preventDefault();
      return;
    }

    // Internal same-root document link: resolve it against the file that
    // is actually being *previewed* (`path`), not the file the hovered
    // anchor originally lived in — the preview can be several links deep
    // from the file open in the editor.
    const resolved = resolveInternalLink(href, path);
    if (resolved) {
      e.preventDefault();
      onOpen(resolved);
      return;
    }

    // Everything else (external http(s), mailto:, etc.): never navigate the
    // app's own tab away — open a new tab instead. `renderCommentMarkdown`
    // already sets target="_blank" rel="noopener noreferrer" on every link,
    // but that alone doesn't stop the *current* tab from also following a
    // relative-looking href, so this still needs an explicit preventDefault.
    e.preventDefault();
    window.open(href, "_blank", "noopener,noreferrer");
  };

  return (
    <Popper
      open={shown}
      anchorEl={anchorEl}
      placement="bottom-start"
      modifiers={POPPER_MODIFIERS}
      sx={{ zIndex: (theme) => theme.zIndex.modal }}
    >
      <Paper
        elevation={8}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        sx={{
          width: "min(480px, 90vw)",
          maxHeight: "50vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            px: 1.5,
            py: 1,
            borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
          }}
        >
          <Typography
            variant="body2"
            sx={{ flexGrow: 1, wordBreak: "break-all", fontWeight: 600 }}
          >
            {path}
          </Typography>
          <IconButton
            size="small"
            aria-label="閉じる"
            onClick={onClose}
            data-testid="link-preview-close"
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
        <Box sx={{ overflowY: "auto", px: 1.5, py: 1 }}>
          {state.status === "loading" && (
            <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
              <CircularProgress size={24} />
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
              onClick={handleContentClick}
              // Same rendering path + compact-article styling as
              // CommentSidePane's comment bodies (markdownBodySx, #213):
              // renderCommentMarkdown escapes raw HTML (html: false), so this
              // is as safe as any other Markdown-derived preview in the app.
              sx={[{ wordBreak: "break-word" }, markdownBodySx]}
              dangerouslySetInnerHTML={{ __html: state.html }}
            />
          )}
        </Box>
        <Box
          sx={{
            display: "flex",
            justifyContent: "flex-end",
            px: 1.5,
            py: 1,
            borderTop: (theme) => `1px solid ${theme.palette.divider}`,
          }}
        >
          <Button
            size="small"
            variant="contained"
            onClick={() => onOpen(path)}
            disabled={state.status !== "ready"}
            data-testid="link-preview-open"
          >
            開く
          </Button>
        </Box>
      </Paper>
    </Popper>
  );
}
