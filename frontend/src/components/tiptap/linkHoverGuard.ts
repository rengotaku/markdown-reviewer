// linkHoverGuard encapsulates the small state machine behind the internal
// link hover preview (#213, hover-card follow-up in #215): "start a timer on
// hover, cancel it on mouseout, and — once a preview has been dismissed while
// the pointer is still over its anchor — refuse to reopen it until the
// pointer actually leaves that anchor". It also owns the "stay area" for the
// non-modal hover card (#215): the card stays open while the pointer is over
// either the link *or* the card itself, and only starts a close countdown
// once it has left both.
//
// Extracted out of TiptapEditor's click/hover DOM listeners so the
// reopen-suppression logic (the part that's easy to regress) has a plain
// unit test independent of TipTap/ProseMirror and real mouse events.
//
// Bug this exists to prevent (#213 follow-up): closing the preview (Esc /
// close button / "Open") while the pointer is still over the link that
// opened it used to let the very next `mouseover` on that same anchor
// immediately restart the hover timer, reopening the preview a moment later
// — so it perpetually intercepted the click the user was trying to make on
// that link.
export class LinkHoverGuard {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  /** Anchor the currently-open (or about-to-open) preview belongs to. */
  private openAnchor: Element | null = null;
  /** Anchor to refuse to reopen a preview for, until the pointer leaves it. */
  private suppressedAnchor: Element | null = null;
  /** Whether the pointer is currently over the link anchor. */
  private overAnchor = false;
  /** Whether the pointer is currently over the hover card itself. */
  private overCard = false;

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private clearCloseTimer(): void {
    if (this.closeTimer !== null) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
  }

  /**
   * (Re)schedules the close-grace timer, but only when the pointer is over
   * neither the anchor nor the card — entering either region cancels the
   * countdown. Called from both the anchor's mouseout and the card's
   * mouseleave, so leaving one region while still over the other never
   * closes the preview.
   */
  private scheduleCloseIfBothOut(delayMs: number, onClose: () => void): void {
    this.clearCloseTimer();
    if (this.overAnchor || this.overCard) return;
    this.closeTimer = setTimeout(onClose, delayMs);
  }

  /**
   * Called on `mouseover` for an anchor that resolves to an internal link.
   * No-ops (returns false, schedules nothing) when `anchor` is currently
   * suppressed. Otherwise arms a timer that calls `onOpen` after `delayMs`
   * and records `anchor` as the open preview's anchor.
   *
   * Returns whether a timer was scheduled, so callers that don't care about
   * the delay itself can still assert on it in tests.
   */
  handleMouseOver(anchor: Element, delayMs: number, onOpen: () => void): boolean {
    this.overAnchor = true;
    // The pointer re-entering the anchor (e.g. it bounced back from the
    // card's gap) cancels any pending close countdown just like re-entering
    // the card does.
    this.clearCloseTimer();
    if (anchor === this.suppressedAnchor) return false;
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.openAnchor = anchor;
      onOpen();
    }, delayMs);
    return true;
  }

  /**
   * Called on `mouseout` for an anchor that resolves to an internal link.
   * Cancels any pending open timer (the pointer left before it fired), and
   * — if this was the suppressed anchor — lifts the suppression, since the
   * pointer genuinely left it.
   *
   * When `closeDelayMs`/`onClose` are given (the preview is open, #215),
   * also starts the close-grace countdown unless the pointer is already
   * over the card.
   */
  handleMouseOut(anchor: Element, closeDelayMs?: number, onClose?: () => void): void {
    this.overAnchor = false;
    if (anchor === this.suppressedAnchor) {
      this.suppressedAnchor = null;
    }
    this.clearTimer();
    if (closeDelayMs !== undefined && onClose) {
      this.scheduleCloseIfBothOut(closeDelayMs, onClose);
    }
  }

  /**
   * Called on `mouseenter` for the hover card (#215). Cancels any pending
   * close countdown — moving from the link onto the card must never close
   * the card the pointer is heading toward.
   */
  handleCardMouseEnter(): void {
    this.overCard = true;
    this.clearCloseTimer();
  }

  /**
   * Called on `mouseleave` for the hover card (#215). Starts the
   * close-grace countdown unless the pointer is back over the anchor.
   */
  handleCardMouseLeave(closeDelayMs: number, onClose: () => void): void {
    this.overCard = false;
    this.scheduleCloseIfBothOut(closeDelayMs, onClose);
  }

  /**
   * Called when the preview is dismissed (Esc / close button / "Open" / the
   * close-grace countdown elapsing) or when a link is clicked directly.
   * Cancels any pending timers.
   *
   * Only suppresses reopening when the pointer is *still over the anchor*
   * at the moment of closing (the #213 case: the user closed it while
   * hovering, and the very next `mouseover` on that same anchor must not
   * immediately restart the hover timer). If the pointer already left the
   * anchor before closing (grace-timeout close, Esc after moving away,
   * "Open" clicked from the card, ...), there's no risk of an immediate
   * re-trigger, so nothing is suppressed — otherwise a later, genuine
   * re-hover of that anchor would silently never reopen the preview (a
   * regression previously caused by unconditionally suppressing here,
   * since a `mouseout` firing *before* the close — as it does for every
   * close path except the still-hovering one — never arrives afterward to
   * lift the suppression).
   */
  handleClose(): void {
    this.suppressedAnchor = this.overAnchor ? this.openAnchor : null;
    this.clearTimer();
    this.clearCloseTimer();
  }

  /** Cancels any pending timers without touching suppression state. Used
   *  when the editor/listener is torn down (unmount, file switch). */
  dispose(): void {
    this.clearTimer();
    this.clearCloseTimer();
  }
}
