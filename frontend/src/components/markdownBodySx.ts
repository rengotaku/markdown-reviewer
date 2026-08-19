import { alpha } from "@mui/material/styles";
import type { Theme } from "@mui/material/styles";
import type { SystemStyleObject } from "@mui/system";

/** Nested-selector styles applied to a rendered Markdown body (#147) so
 *  block elements (headings/lists/tables/code/...) read as a compact preview
 *  row rather than a full article: tight vertical rhythm, no leading/trailing
 *  gap, a horizontally-scrollable table (never widening the side pane), and
 *  colors drawn from theme tokens so light/dark both work without hardcoded
 *  hex. No syntax highlighting — code blocks are just monospace + a flat
 *  tint.
 *
 *  Shared between CommentSidePane's comment/reply bodies and
 *  LinkPreviewModal's internal-link preview (#213) — both render Markdown
 *  via renderCommentMarkdown and want the same compact-article look. */
export function markdownBodySx(theme: Theme): SystemStyleObject<Theme> {
  const codeBg = alpha(theme.palette.text.primary, 0.08);
  return {
    "& > :first-of-type": { mt: 0 },
    "& > :last-child": { mb: 0 },
    "& p": { my: 0.75 },
    // Tailwind's preflight resets h1-h6 to inherited size/weight, so a `##`
    // would render indistinguishable from body text. Restore a compact scale
    // sized for the narrow side pane rather than article-sized headings.
    "& h1, & h2, & h3, & h4, & h5, & h6": {
      mt: 1.25,
      mb: 0.5,
      fontWeight: 700,
      lineHeight: 1.3,
    },
    "& h1": { fontSize: "1.2em" },
    "& h2": { fontSize: "1.1em" },
    "& h3": { fontSize: "1.02em" },
    "& h4, & h5, & h6": { fontSize: "1em", color: theme.palette.text.secondary },
    // Tailwind's preflight zeroes out list markers globally, so restore them
    // here. Matches the editor's convention (DiffGutter/tiptap): disc at every
    // nesting level for <ul>, decimal for <ol>.
    "& ul, & ol": { my: 0.75, pl: 3 },
    "& ul": { listStyleType: "disc" },
    "& ol": { listStyleType: "decimal" },
    "& li": { display: "list-item" },
    "& li + li": { mt: 0.25 },
    "& li > ul, & li > ol": { my: 0.25 },
    "& blockquote": {
      my: 0.75,
      pl: 1.5,
      ml: 0,
      borderLeft: `3px solid ${theme.palette.divider}`,
      color: theme.palette.text.secondary,
    },
    "& hr": { my: 1, border: 0, borderTop: `1px solid ${theme.palette.divider}` },
    "& code": {
      fontFamily:
        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      fontSize: "0.85em",
      bgcolor: codeBg,
      px: 0.5,
      py: 0.125,
      borderRadius: 0.5,
    },
    "& pre": {
      my: 0.75,
      p: 1,
      borderRadius: 1,
      bgcolor: codeBg,
      overflowX: "auto",
    },
    "& pre code": { bgcolor: "transparent", p: 0, fontSize: "0.8em" },
    "& table": {
      display: "block",
      overflowX: "auto",
      maxWidth: "100%",
      my: 0.75,
      borderCollapse: "collapse",
    },
    // Horizontal cell padding is kept tight (4px) on purpose: the table box
    // itself lines up with the surrounding paragraphs, so every px of
    // border+padding shifts the first column's *text* right and reads as the
    // table being indented. 1px border + 4px keeps that offset at 5px.
    "& th, & td": {
      border: `1px solid ${theme.palette.divider}`,
      px: 0.5,
      py: 0.5,
    },
    "& a": { color: theme.palette.primary.main },
  };
}
