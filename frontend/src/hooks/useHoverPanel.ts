import { useEffect, useRef } from "react";
import { HoverPanelGuard } from "@/utils/hoverPanelGuard";

const HOT_ZONE_OPEN_DELAY_MS = 120;
const CLOSE_GRACE_DELAY_MS = 250;

interface UseHoverPanelOptions {
  /** Called (possibly synchronously) once the guard decides the panel
   *  should be shown / hidden. Typically wired to a zustand setter. */
  onOpen: () => void;
  onClose: () => void;
  /** When true, hover tracking is skipped entirely — used for the sidebar's
   *  "pinned" state (#219), where the panel is always visible via the push
   *  layout and hover-driven show/hide would be pointless (and could leave
   *  stale timers armed for the next un-pin). */
  disabled?: boolean;
}

/** Event handlers for the two "stay area" regions (see hoverPanelGuard.ts)
 *  plus the timing constants, so callers can spread the handlers directly
 *  onto the hot zone / panel elements. */
interface UseHoverPanelResult {
  hotZoneHandlers: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
  };
  panelHandlers: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
  };
}

/**
 * React hook wrapping HoverPanelGuard for the Notion-style hover-to-reveal
 * sidebar (#219). Owns the guard instance's lifetime (disposed on unmount or
 * when `disabled` flips true, so no stale timers fire after the sidebar
 * becomes pinned) and exposes plain event handler objects for the hot zone
 * and panel elements.
 */
export function useHoverPanel({
  onOpen,
  onClose,
  disabled = false,
}: UseHoverPanelOptions): UseHoverPanelResult {
  const guardRef = useRef<HoverPanelGuard | null>(null);
  if (guardRef.current === null) {
    guardRef.current = new HoverPanelGuard();
  }

  // Latest callbacks in refs so the handlers below stay referentially
  // stable across renders without re-subscribing timers mid-flight. Updated
  // in an effect (not during render) to satisfy react-hooks/refs.
  const onOpenRef = useRef(onOpen);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onOpenRef.current = onOpen;
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const guard = guardRef.current;
    return () => {
      guard?.dispose();
    };
  }, []);

  useEffect(() => {
    if (disabled) {
      guardRef.current?.dispose();
    }
  }, [disabled]);

  return {
    hotZoneHandlers: {
      onMouseEnter: () => {
        if (disabled) return;
        guardRef.current?.handleHotZoneEnter(HOT_ZONE_OPEN_DELAY_MS, () =>
          onOpenRef.current()
        );
      },
      onMouseLeave: () => {
        if (disabled) return;
        guardRef.current?.handleHotZoneLeave(CLOSE_GRACE_DELAY_MS, () =>
          onCloseRef.current()
        );
      },
    },
    panelHandlers: {
      onMouseEnter: () => {
        if (disabled) return;
        guardRef.current?.handlePanelEnter();
      },
      onMouseLeave: () => {
        if (disabled) return;
        guardRef.current?.handlePanelLeave(CLOSE_GRACE_DELAY_MS, () =>
          onCloseRef.current()
        );
      },
    },
  };
}
