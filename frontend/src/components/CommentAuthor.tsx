import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import {
  authorHue,
  authorInitials,
  isAiAuthored,
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
  const ai = isAiAuthored(author);
  const hue = authorHue(author);
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}>
      <Box
        aria-hidden
        data-testid="comment-author-badge"
        data-author={author ?? ""}
        sx={{
          width: 20,
          height: 20,
          flexShrink: 0,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          fontSize: 10,
          fontWeight: 700,
          lineHeight: 1,
          // The AI is one fixed identity; people get a hue derived from their
          // name so two reviewers never share a colour by accident.
          bgcolor: ai ? "success.light" : `hsl(${hue} 55% 88%)`,
          color: ai ? "success.dark" : `hsl(${hue} 45% 28%)`,
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
