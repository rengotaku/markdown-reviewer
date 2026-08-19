// linkHoverGuard encapsulates the small state machine behind the internal
// link hover preview (#213): "start a timer on hover, cancel it on
// mouseout, and — once a preview has been dismissed while the pointer is
// still over its anchor — refuse to reopen it until the pointer actually
// leaves that anchor".
//
// Extracted out of TiptapEditor's click/hover DOM listeners so the
// reopen-suppression logic (the part that's easy to regress) has a plain
// unit test independent of TipTap/ProseMirror and real mouse events.
//
// Bug this exists to prevent (#213 follow-up): closing the preview modal
// (Esc / backdrop / close button / "Open") while the pointer is still over
// the link that opened it used to let the very next `mouseover` on that
// same anchor immediately restart the hover timer, reopening the modal a
// moment later — so the modal's overlay perpetually intercepted the click
// the user was trying to make on that link.
export class LinkHoverGuard {
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Anchor the currently-open (or about-to-open) preview belongs to. */
  private openAnchor: Element | null = null;
  /** Anchor to refuse to reopen a preview for, until the pointer leaves it. */
  private suppressedAnchor: Element | null = null;

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
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
   */
  handleMouseOut(anchor: Element): void {
    if (anchor === this.suppressedAnchor) {
      this.suppressedAnchor = null;
    }
    this.clearTimer();
  }

  /**
   * Called when the preview is dismissed (Esc / backdrop / close button /
   * "Open") or when a link is clicked directly. Cancels any pending timer
   * and marks the open preview's anchor (if any) as suppressed so hovering
   * straight back onto it — without ever leaving — doesn't reopen it.
   */
  handleClose(): void {
    this.suppressedAnchor = this.openAnchor;
    this.clearTimer();
  }

  /** Cancels any pending timer without touching suppression state. Used
   *  when the editor/listener is torn down (unmount, file switch). */
  dispose(): void {
    this.clearTimer();
  }
}
