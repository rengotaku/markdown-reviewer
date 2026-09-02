import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import type { CommentJSON } from "@/api";
import { renderCommentMarkdown } from "@/utils/commentMarkdown";
import { markdownBodySx } from "./markdownBodySx";

/** Lines of body kept in the preview. It exists to answer "what does this say"
 *  at a glance — a long comment is read in the thread, not here — so the clamp
 *  is deliberate rather than a fallback. Line-clamped rather than height-capped
 *  with a fade: a fade sits on top of the last line whether or not anything was
 *  actually cut, which reads as damage on a body that fit.  */
const PREVIEW_LINES = 5;

interface Props {
  comment: CommentJSON;
}

/** Read-only card shown while the pointer rests on a comment highlight (#251).
 *  Hover reads, click writes: every action — reply, resolve, edit, delete —
 *  lives in CommentThreadPopover. The card carries no controls of its own, but
 *  it does take the click that opens the thread: it covers the text it
 *  describes, so a pointer that drifted onto it while reading would otherwise
 *  land on nothing while the card says "クリックで開く". */
export function CommentHoverPreview({ comment }: Props) {
  const replyCount = comment.replies?.length ?? 0;
  return (
    <Paper
      elevation={4}
      data-testid="comment-hover-preview"
      sx={{ width: 288, p: 1.25, cursor: "pointer" }}
    >
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: "block", fontWeight: 500 }}
      >
        {comment.author || "unknown"}
        {comment.date ? ` · ${comment.date}` : ""}
      </Typography>
      <Typography
        variant="body2"
        component="div"
        data-testid="comment-hover-preview-body"
        // XSS-safe: see commentMarkdown.ts (html:false + unmodified validateLink()).
        dangerouslySetInnerHTML={{ __html: renderCommentMarkdown(comment.body) }}
        sx={[
          markdownBodySx,
          {
            mt: 0.5,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: PREVIEW_LINES,
            // The clamp only reaches the box's own text, so the first block
            // stays inline; anything past it is what the thread is for.
            "& > *": { display: "inline" },
            "& > * + *::before": { content: '" "' },
          },
        ]}
      />
      <Box
        sx={{
          mt: 0.75,
          display: "flex",
          gap: 1,
          color: "text.disabled",
          fontSize: 11,
        }}
      >
        {replyCount > 0 && <span>返信 {replyCount} 件</span>}
        <span>クリックで開く</span>
      </Box>
    </Paper>
  );
}
