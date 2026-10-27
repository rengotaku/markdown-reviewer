import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import {
  authorColor,
  authorInitials,
  relativeDate,
} from "@/utils/commentPresentation";

interface Props {
  author?: string;
  date?: string;
  /** Compact rows drop the name and keep the badge + time. */
  showName?: boolean;
}

/** Who wrote a comment and how long ago (#253). An AI and a person take turns
 *  in these threads, so the badge is colour-coded by author rather than being
 *  a neutral avatar: at a glance the reader can tell whose turn it was. */
export function CommentAuthor({ author, date, showName = true }: Props) {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.75,
        // #364: badge-only, it must not shrink under a neighbour's text.
        minWidth: showName ? 0 : undefined,
        flexShrink: showName ? undefined : 0,
      }}
    >
      {/* #364: with the name hidden the badge is the only author signal, so
          it carries the name for screen readers instead of being hidden. */}
      <Box
        aria-hidden={showName || undefined}
        role={showName ? undefined : "img"}
        aria-label={showName ? undefined : author || "?"}
        title={author || undefined}
        data-testid="comment-author-badge"
        data-author={author ?? ""}
        sx={{
          // #364: badge-only rows put it beside 14px action icons; keep it
          // about that size so the row stays low.
          width: showName ? 20 : 16,
          height: showName ? 20 : 16,
          flexShrink: 0,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          fontSize: showName ? 10 : 8,
          fontWeight: 700,
          lineHeight: 1,
          // #364: the same colour as the author's stripe on thread entries.
          bgcolor: authorColor(author),
          color: "common.white",
        }}
      >
        {authorInitials(author)}
      </Box>
      {showName && (
        <Typography
          variant="body2"
          sx={{
            fontWeight: 600,
            color: "text.primary",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {author || "?"}
        </Typography>
      )}
      {date && (
        <Typography
          variant="caption"
          color="text.secondary"
          data-testid="comment-relative-date"
          title={date}
          sx={{ flexShrink: 0 }}
        >
          {relativeDate(date)}
        </Typography>
      )}
    </Box>
  );
}
