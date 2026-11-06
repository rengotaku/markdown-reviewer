import Box from "@mui/material/Box";

/** Same as MUI's visuallyHidden: read by screen readers, never drawn. */
const VISUALLY_HIDDEN_SX = {
  border: 0,
  clip: "rect(0 0 0 0)",
  height: "1px",
  margin: "-1px",
  overflow: "hidden",
  padding: 0,
  position: "absolute",
  whiteSpace: "nowrap",
  width: "1px",
} as const;

interface Props {
  count: number;
  /** Read before the number by screen readers ("未送信" → "未送信 3"); the
   *  badge itself only draws the number. */
  label?: string;
  /** "filled" for an outlined button, "outlined" for a contained one, so the
   *  badge stands apart from the button's own fill either way. */
  variant?: "filled" | "outlined";
  testId?: string;
  /** "bottom" for a button that already carries a badge at the top-right
   *  (the send button's green reply count). */
  placement?: "top" | "bottom";
  /** "warning" for the 位置不明 count, which is a warning rather than news
   *  (#394). Applies to the filled variant only. */
  color?: "primary" | "warning";
  /** For a button flush against the window's top-right corner (the header's
   *  comment-pane button, #394): the badge tucks 2px further in on each side
   *  so the window edge doesn't clip it. */
  atEdge?: boolean;
}

/** #379: a count laid over its button's top-right corner. Counts used to sit
 *  inside the button, so the button changed width whenever one came or went
 *  — a send clearing "未送信 N", a summary arriving — and shifted everything
 *  beside it. Overlaid, the button keeps its width. The button must be the
 *  positioned ancestor (MUI's ButtonBase is `position: relative`). */
export function CountBadge({
  count,
  label,
  variant = "filled",
  testId,
  placement = "top",
  color = "primary",
  atEdge = false,
}: Props) {
  return (
    <Box
      component="span"
      data-testid={testId}
      sx={[
        {
          position: "absolute",
          // The header buttons sit 5px below the window's top edge; -4 keeps
          // the badge whole there.
          ...(placement === "top" ? { top: atEdge ? -2 : -4 } : { bottom: -4 }),
          right: atEdge ? -2 : -6,
          minWidth: 16,
          height: 16,
          px: 0.5,
          boxSizing: "border-box",
          borderRadius: 8,
          fontSize: 10,
          fontWeight: 700,
          lineHeight: 1,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
        },
        variant === "filled"
          ? { bgcolor: `${color}.main`, color: `${color}.contrastText` }
          : {
              bgcolor: "background.paper",
              color: "primary.main",
              border: "1px solid",
              borderColor: "primary.main",
            },
      ]}
    >
      {label && (
        <Box component="span" sx={VISUALLY_HIDDEN_SX}>
          {label}{" "}
        </Box>
      )}
      {count}
    </Box>
  );
}
