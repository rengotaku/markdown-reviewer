/** Space kept between two stacked cards. */
export const RAIL_GAP = 8;

/** A single card's height is capped so one long thread can't push every
 *  other card off the rail; the card scrolls inside itself past this. */
export const RAIL_CARD_MAX_HEIGHT = 320;

export interface RailItem {
  id: string;
  /** Highlight's viewport top, or null for comments with no live anchor
   *  (global scope, orphan) — those never reach the rail (#298). */
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
  paneHeight: number;
  /** Defaults to RAIL_GAP. */
  gap?: number;
}

export interface RailPlacedItem {
  id: string;
  /** Top, relative to the pane's own box (`position: relative`). */
  top: number;
  /** Height the card is allotted (min(measured, RAIL_CARD_MAX_HEIGHT), further
   *  shrunk only when a lone leading card would otherwise overflow the pane). */
  maxHeight: number;
}

export interface RailLayoutResult {
  visible: RailPlacedItem[];
  /** Cards pushed out above the pane (their target sits above the current
   *  scroll position) — jump up to see them. */
  aboveCount: number;
  /** Cards that don't fit before the pane's bottom edge — jump down. */
  belowCount: number;
  /** Comments with no anchor (`anchorTop === null`): never placed, never
   *  counted above/below. They stay in the pinned section instead. */
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
 * case it is pushed down to sit right below. A top clamped to 0 (anchor only
 * partially above the pane — its bottom edge would still land inside it) is
 * not itself a failure — several such cards stack from 0 same as any other
 * overlap. But a card whose whole height sits above the pane (its bottom
 * edge, unclamped, is still above the pane's top) never clamps or stacks at
 * all: it's dropped straight to `aboveCount` so it can't crowd out a card
 * for a paragraph that's actually on screen (#298 follow-up — the original
 * "clamp to 0" rule, meant for a small overshoot, was also swallowing
 * comments scrolled far out of view and pushing on-screen cards down by
 * however many of those had piled up at the top). A card only drops out of
 * `visible` when it truly can't fit before the pane's bottom edge; which
 * bucket (`aboveCount`/`belowCount`) it lands in is decided by where its own
 * (unclamped) anchor sits, not by where the stack pushed it.
 */
export function layoutCommentRail(
  items: readonly RailItem[],
  viewport: RailViewport
): RailLayoutResult {
  const gap = viewport.gap ?? RAIL_GAP;
  const { paneTop, paneHeight } = viewport;

  const excluded: string[] = [];
  const anchored = items.filter((item) => {
    if (item.anchorTop === null) {
      excluded.push(item.id);
      return false;
    }
    return true;
  });
  const ordered = [...anchored].sort((a, b) => a.order - b.order);

  const visible: RailPlacedItem[] = [];
  let aboveCount = 0;
  let belowCount = 0;
  let cursor = 0;

  for (const item of ordered) {
    const cardHeight = Math.min(item.height, RAIL_CARD_MAX_HEIGHT);
    // anchorTop is non-null here — this item survived the `excluded` filter.
    const relativeAnchor = (item.anchorTop as number) - paneTop;

    // The card's whole box sits above the pane's top edge (not just a small
    // overshoot) — clamping this to top 0 would stack it in front of cards
    // whose paragraphs are actually visible, pushing them down. Count it as
    // scrolled-past instead, without touching `cursor`.
    if (relativeAnchor <= -cardHeight) {
      aboveCount += 1;
      continue;
    }

    const isFirstVisible = cursor === 0;
    const top = Math.max(relativeAnchor, cursor, 0);

    if (top + cardHeight > paneHeight) {
      // Nothing above it is claiming space, so there's no better place to put
      // it: shrink it to the pane instead of dropping it entirely (#298's
      // "単体でペイン高さを超えるカードは top 0 で置き").
      if (isFirstVisible) {
        const fitHeight = Math.max(0, paneHeight - top);
        visible.push({ id: item.id, top, maxHeight: fitHeight });
        cursor = top + fitHeight + gap;
        continue;
      }
      // relativeAnchor here is > -cardHeight (else it would have been
      // caught by the fully-above-the-pane check above), so `< 0` only
      // covers the small-overshoot case, not "scrolled far out of view".
      if (relativeAnchor < 0) {
        aboveCount += 1;
      } else {
        belowCount += 1;
      }
      continue;
    }

    visible.push({ id: item.id, top, maxHeight: cardHeight });
    cursor = top + cardHeight + gap;
  }

  return { visible, aboveCount, belowCount, excluded };
}
