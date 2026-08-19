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
 *  LinkPreviewCard's internal-link preview (#213/#215) — both render Markdown
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
    // External-link marker (#215 follow-up): renderCommentMarkdown only adds
    // `cm-link-external` when called with a `currentPath` — today that's
    // LinkPreviewCard alone, so this rule is inert for CommentSidePane
    // (no such class ever appears in its output) despite the shared sx.
    "& a.cm-link-external::after": {
      content: '""',
      display: "inline-block",
      width: "0.7em",
      height: "0.7em",
      ml: "0.2em",
      verticalAlign: "-0.05em",
      backgroundColor: "currentColor",
      opacity: 0.65,
      WebkitMaskImage:
        "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z'/%3E%3C/svg%3E\")",
      maskImage:
        "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z'/%3E%3C/svg%3E\")",
      WebkitMaskSize: "contain",
      maskSize: "contain",
      WebkitMaskRepeat: "no-repeat",
      maskRepeat: "no-repeat",
      pointerEvents: "none",
    },
  };
}
