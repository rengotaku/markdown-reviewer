/** Selector for the scroll container introduced by #152: `.ProseMirror
 *  table` gets `display: block; overflow-x: auto` so a wide table scrolls
 *  horizontally inside the (narrower, centered) prose column instead of
 *  blowing out the page width. */
const SCROLL_CONTAINER_SELECTOR = ".ProseMirror table";

/**
 * Scrolls the nearest `.ProseMirror table` ancestor of `target` horizontally
 * so `target` lands inside the container's visible width (#310).
 *
 * `Element.scrollIntoView` already handles the vertical axis for jump/select
 * (`block: "center"`), and left alone would default the inline axis to
 * "nearest" — but that default is unreliable across browsers/jsdom and,
 * more importantly, untestable without a real layout engine. This computes
 * the adjustment from `getBoundingClientRect()` and sets `scrollLeft`
 * directly, purely and synchronously: no rAF, no dependency on the pane's
 * own height (unlike `layoutCommentRail`, this never touches vertical
 * layout and is a no-op when there is no table to scroll).
 *
 * A target already fully inside the container's width is left untouched
 * (idempotent — the #152 vertical highlight/#298 rail flow doesn't call
 * this twice, but nothing here would misbehave if it did).
 */
export function scrollTableIntoView(target: Element): void {
  const container = target.closest<HTMLElement>(SCROLL_CONTAINER_SELECTOR);
  if (!container) return;

  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();

  if (targetRect.left < containerRect.left) {
    container.scrollLeft -= containerRect.left - targetRect.left;
  } else if (targetRect.right > containerRect.right) {
    container.scrollLeft += targetRect.right - containerRect.right;
  }
}
