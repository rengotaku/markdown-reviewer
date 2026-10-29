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
  /** Highest top (relative to the pane) any card may take; the first card
   *  starts no higher than this. Lets the caller keep the top of the
   *  document's first card clear of whatever sits above the rail (#338).
   *  Unbounded when omitted. */
  minTop?: number;
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
  let cursor = viewport.minTop ?? Number.NEGATIVE_INFINITY;
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

/** Where a selected card's highlight should be scrolled to — its top relative
 *  to the pane — so the card itself lands inside the pane (#339). Centring the
 *  highlight is the default, but a card stacked below others on the same line
 *  sits `placed.top - anchorRel` further down than its highlight, and with
 *  enough of them that pushes it past the pane's bottom edge. The card is
 *  pulled back up until its bottom fits, never above `gap` from the top. The
 *  room kept for it is RAIL_CARD_MAX_HEIGHT, not its current height: the
 *  selected card shows its body in full (#330), so it grows once selected.
 *  `anchorRel` is the highlight's current top relative to the pane; the
 *  offset between highlight and card holds still while the body scrolls,
 *  since both move by the same amount. */
export function revealAnchorTop(
  placed: RailPlacedItem,
  anchorRel: number,
  paneHeight: number,
  gap: number = RAIL_GAP
): number {
  const offset = placed.top - anchorRel;
  const centred = paneHeight / 2 + offset;
  const lowest = Math.max(gap, paneHeight - gap - RAIL_CARD_MAX_HEIGHT);
  return Math.max(gap, Math.min(centred, lowest)) - offset;
}

/** How far the body must scroll down for a card being written in to stay
 *  inside the pane (#378). #339 lifts a card only when it is selected; a
 *  reply or edit form opened afterwards grows the card past the pane's bottom,
 *  and near the end of the document nothing else brings it back. `cardTop` and
 *  `cardBottom` are relative to the pane. The card is lifted until its bottom
 *  sits `gap` above the pane's bottom, but never so far that its top (the
 *  header) leaves the pane — in a pane shorter than the card the field stays
 *  in reach by scrolling inside the card instead. 0 when it already fits. */
export function liftIntoPane(
  cardTop: number,
  cardBottom: number,
  paneHeight: number,
  gap: number = RAIL_GAP
): number {
  const overflow = cardBottom + gap - paneHeight;
  const headroom = cardTop - gap;
  return Math.max(0, Math.min(overflow, headroom));
}
