import Box from "@mui/material/Box";

interface Props {
  id: string;
}

/** The comment's own identifier (`c-001`), shown wherever a person reads a
 *  comment (#286). The AI refers to comments by this id when it reports what
 *  it changed — "c-003 を反映した" — and until the id was on screen there was
 *  no way to tell which comment that was. Monospace and dim: it is a handle to
 *  match against a message, not part of what the comment says. */
export function CommentId({ id }: Props) {
  return (
    <Box
      component="span"
      data-testid="comment-id"
      title={`コメント ID: ${id}`}
      sx={{
        flexShrink: 0,
        fontFamily: "monospace",
        fontSize: "0.65rem",
        lineHeight: 1.6,
        px: 0.5,
        borderRadius: 0.5,
        bgcolor: "action.hover",
        color: "text.secondary",
        // Copyable on its own: the id is what gets pasted back to the AI.
        userSelect: "all",
      }}
    >
      {id}
    </Box>
  );
}
