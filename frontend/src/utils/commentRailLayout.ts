/** Space kept between two stacked cards. */
export const RAIL_GAP = 8;

/** A single card's height is capped so one long thread can't push every
 *  other card far from its paragraph; the card scrolls inside itself past
 *  this. */
export const RAIL_CARD_MAX_HEIGHT = 320;

export interface RailItem {
  id: string;
  /** Highlight's viewport top, or null for comments with no live anchor
   *  (global scope, orphan, or not measured yet) — those never reach the
   *  rail (#298). */
  anchorTop: number | null;
  /** Measured card height (pre-clamp). */
  height: number;
  /** Document order; ties the rail's vertical order to reading order. */
  order: number;
}

export interface RailViewport {
  /** Pane's own viewport top, so `anchorTop` (viewport-absolute) can be
   *  turned into a top relative to the pane. */
  paneTop: number;
  /** Defaults to RAIL_GAP. */
  gap?: number;
}

export interface RailPlacedItem {
  id: string;
  /** Top, relative to the pane's own box (`position: relative`). Negative or
   *  past the pane's height when the card sits outside the scrolled-to
   *  range — the pane clips it, and scrolling the body brings it in. */
  top: number;
  /** Height the card is allotted: min(measured, RAIL_CARD_MAX_HEIGHT). */
  maxHeight: number;
}

export interface RailLayoutResult {
  /** Every anchored item, in document order. */
  placed: RailPlacedItem[];
  /** Bottom edge of the last placed card, relative to the pane — how far
   *  down the rail reaches, so the caller can make the body scroll at least
   *  that far (#338). null when nothing is placed. */
  bottom: number | null;
  /** Comments with no anchor (`anchorTop === null`): never placed. They stay
   *  in the pinned section instead. */
  excluded: string[];
}

/**
 * Places anchored comment cards down the rail, aligned with the paragraph
 * they're attached to (#298). Pure and DOM-free so the stacking rules are
 * unit-testable: callers measure `anchorTop`/`height` from the DOM and this
 * function only does arithmetic.
 *
 * Cards are laid out in document order (`order`), each card's top pinned to
 * its anchor unless an earlier card's bottom edge would overlap it, in which
 * case it is pushed down to sit right below.
 *
 * Nothing is clamped to the pane or dropped for not fitting (#338). The rail
 * used to be a viewport-sized box that hid whatever didn't fit behind
 * "上に / 下に N 件"; a card for a paragraph near the end of the document
 * could land there with no scroll position left to bring it in. Every card
 * now gets a place in the body's coordinates, so the layout only shifts as a
 * whole when the body scrolls (all anchors move by the same amount), and
 * scrolling is what reveals a card that sits outside the pane.
 */
export function layoutCommentRail(
  items: readonly RailItem[],
  viewport: RailViewport
): RailLayoutResult {
  const gap = viewport.gap ?? RAIL_GAP;
  const excluded: string[] = [];
  const anchored = items.filter((item) => {
    if (item.anchorTop === null) {
      excluded.push(item.id);
      return false;
    }
    return true;
  });
  const ordered = [...anchored].sort((a, b) => a.order - b.order);

  const placed: RailPlacedItem[] = [];
  let cursor = Number.NEGATIVE_INFINITY;
  for (const item of ordered) {
    const cardHeight = Math.min(item.height, RAIL_CARD_MAX_HEIGHT);
    // anchorTop is non-null here — this item survived the `excluded` filter.
    const top = Math.max((item.anchorTop as number) - viewport.paneTop, cursor);
    placed.push({ id: item.id, top, maxHeight: cardHeight });
    cursor = top + cardHeight + gap;
  }

  const last = placed[placed.length - 1];
  return {
    placed,
    bottom: last ? last.top + last.maxHeight : null,
    excluded,
  };
}

/** Whether a placed card overlaps the pane's visible range at all. Cards
 *  outside it stay mounted (so their measured heights keep feeding the
 *  stacking above) but are hidden from view and from keyboard focus. */
export function isPlacedInPane(placed: RailPlacedItem, paneHeight: number): boolean {
  return placed.top < paneHeight && placed.top + placed.maxHeight > 0;
}
