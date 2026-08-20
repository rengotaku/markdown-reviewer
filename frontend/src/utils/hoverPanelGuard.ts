// HoverPanelGuard encapsulates the "stay area" state machine behind the
// Notion-style hover-to-reveal sidebar (#219): a narrow hot zone at the
// window edge opens the panel after a short delay, and the panel stays open
// while the pointer is over either the hot zone *or* the panel itself,
// closing only after a grace period once it has left both.
//
// This is a sibling of components/tiptap/linkHoverGuard.ts (#215's "stay
// area while over link or card" logic), not a reuse of it: LinkHoverGuard
// additionally tracks per-anchor reopen-suppression (so dismissing a hover
// card while still over its *specific* link doesn't immediately reopen it),
// which only makes sense when there can be many anchors. The sidebar has
// exactly one hot zone and one panel, so that per-anchor bookkeeping doesn't
// apply here — but the underlying "two stay regions + close-grace timer"
// design is copied deliberately, including the same regression this exists
// to avoid:
//
// - if leaving the hot zone into the panel (or vice versa) closed
//   immediately, the panel would flicker shut while the pointer is still
//   genuinely using it;
// - if the close-grace timer weren't cancelable by re-entering either
//   region, a brief overshoot past the panel edge would still close it even
//   though the pointer came right back.
export class HoverPanelGuard {
  private openTimer: ReturnType<typeof setTimeout> | null = null;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private overHotZone = false;
  private overPanel = false;

  private clearOpenTimer(): void {
    if (this.openTimer !== null) {
      clearTimeout(this.openTimer);
      this.openTimer = null;
    }
  }

  private clearCloseTimer(): void {
    if (this.closeTimer !== null) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
  }

  /** (Re)schedules the close-grace timer, but only when the pointer is over
   *  neither the hot zone nor the panel. Entering either region cancels it. */
  private scheduleCloseIfBothOut(delayMs: number, onClose: () => void): void {
    this.clearCloseTimer();
    if (this.overHotZone || this.overPanel) return;
    this.closeTimer = setTimeout(onClose, delayMs);
  }

  /** Pointer entered the hot zone: cancels any pending close and arms the
   *  open timer (unless the panel is already open, in which case there's
   *  nothing to schedule — the caller passes the same `onOpen` regardless of
   *  current state, so this stays idempotent). */
  handleHotZoneEnter(delayMs: number, onOpen: () => void): void {
    this.overHotZone = true;
    this.clearCloseTimer();
    this.clearOpenTimer();
    this.openTimer = setTimeout(() => {
      this.openTimer = null;
      onOpen();
    }, delayMs);
  }

  /** Pointer left the hot zone: cancels a pending open (if it hadn't fired
   *  yet) and starts the close-grace countdown unless the panel now has the
   *  pointer. */
  handleHotZoneLeave(closeDelayMs: number, onClose: () => void): void {
    this.overHotZone = false;
    this.clearOpenTimer();
    this.scheduleCloseIfBothOut(closeDelayMs, onClose);
  }

  /** Pointer entered the panel: cancels any pending close countdown, since
   *  moving from the hot zone onto the panel must never close it. */
  handlePanelEnter(): void {
    this.overPanel = true;
    this.clearCloseTimer();
  }

  /** Pointer left the panel: starts the close-grace countdown unless the
   *  pointer is back over the hot zone. */
  handlePanelLeave(closeDelayMs: number, onClose: () => void): void {
    this.overPanel = false;
    this.scheduleCloseIfBothOut(closeDelayMs, onClose);
  }

  /**
   * Cancels all pending timers and force-clears both region flags to
   * "pointer is not here", regardless of whether a matching
   * `handle*Leave` was ever delivered for either region.
   *
   * Exists as a safety net for the #219 stuck-open bug: if a region's DOM
   * element is ever removed while the pointer sits over it (the hot zone
   * previously did this whenever the overlay opened — see the render-side
   * fix in EditorPage.tsx), the browser never fires that element's
   * `mouseleave`, so `overHotZone`/`overPanel` would otherwise latch `true`
   * forever. `scheduleCloseIfBothOut` then always early-returns and the
   * panel can never close again. Calling this whenever a region's mount
   * state changes unexpectedly (or on teardown, via `dispose`) guarantees
   * the guard can't get permanently wedged in the "open" stay-area state.
   */
  resetRegions(): void {
    this.clearOpenTimer();
    this.clearCloseTimer();
    this.overHotZone = false;
    this.overPanel = false;
  }

  /** Cancels all pending timers and resets stay-area tracking. Used when the
   *  panel becomes pinned (no longer needs hover tracking) or the component
   *  unmounts. */
  dispose(): void {
    this.resetRegions();
  }
}
