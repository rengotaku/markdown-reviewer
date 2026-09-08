/** Tallest a comment popover may grow. Also the room the anchor needs below it
 *  for the card to open downwards. */
export const POPOVER_MAX_HEIGHT = 440;
/** Shortest a comment popover may be squeezed to. Below this a thread is
 *  unreadable, so the card overflows rather than shrinking further. */
export const POPOVER_MIN_HEIGHT = 240;
/** Breathing room kept between the anchor and the viewport edge. */
const GAP = 16;

/** The part of a DOMRect the frame is computed from. */
export interface AnchorBox {
  top: number;
  bottom: number;
}

export interface PopoverFrame {
  placement: "bottom-start" | "top-start";
  maxHeight: number;
}

/** Which side a comment popover opens on, and how tall it may grow. Popper
 *  repositions but never shrinks a card that does not fit, so the card is told
 *  its own ceiling — an expanded thread is taller than most gaps.
 *
 *  Downwards is the default: the card lands where the user just clicked or
 *  selected. It only flips up when the card cannot fit below, and then it
 *  takes whichever side is roomier. Picking the roomier side outright (what
 *  this did before #284) sent the card above the anchor whenever the selection
 *  sat past the middle of the viewport, even with ample space below it. */
export function popoverFrame(
  rect: AnchorBox | null,
  viewportHeight: number = window.innerHeight
): PopoverFrame {
  if (!rect) return { placement: "bottom-start", maxHeight: 0 };
  const below = viewportHeight - rect.bottom - GAP;
  const above = rect.top - GAP;
  const openDown = below >= POPOVER_MAX_HEIGHT || below >= above;
  return {
    placement: openDown ? "bottom-start" : "top-start",
    maxHeight: Math.max(
      POPOVER_MIN_HEIGHT,
      Math.min(POPOVER_MAX_HEIGHT, openDown ? below : above)
    ),
  };
}
