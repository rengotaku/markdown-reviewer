import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useConfig } from "@/hooks/useConfig";
import type { ReviewRootEntry } from "@/api";

/**
 * URL search param that selects which configured review root the UI is
 * currently scoped to. Appears in the browser URL as `?root=<name>` so
 * shared / bookmarked links preserve the active root.
 */
export const TAB_PARAM = "root";

interface UseActiveRootResult {
  /** Name of the active root, or "" while /api/config is still loading. */
  active: string;
  /** All configured roots (declaration order). Empty while loading. */
  roots: ReviewRootEntry[];
  /** Absolute path of the active root (empty until config arrives). */
  activePath: string;
  /**
   * Switch to the named root. No-op when `name` already matches `active` or
   * when the name isn't in the configured set — the latter prevents URL
   * tampering from putting the UI into an unrenderable state.
   */
  setActive: (name: string) => void;
}

/**
 * Tracks "which configured root is the UI currently showing".
 *
 * Source of truth is the URL `?root=<name>` param so the active root survives
 * reloads + is shareable. We bounce the value through React Router's
 * `useSearchParams` so navigating with browser back/forward picks up the
 * intended root. When the URL has no `?root=`, the first declared root in
 * /api/config is used as the default — kept implicit (no param written)
 * so the URL stays clean for the common "single root" case.
 */
export function useActiveRoot(): UseActiveRootResult {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: config } = useConfig();

  const roots = useMemo<ReviewRootEntry[]>(
    () => config?.review_roots ?? [],
    [config]
  );

  const requested = searchParams.get(TAB_PARAM) ?? "";
  // Reject URL values that don't match a known root so the rest of the UI
  // doesn't have to handle a phantom selection.
  const validRequested = roots.some((r) => r.name === requested)
    ? requested
    : "";
  const active = validRequested || roots[0]?.name || "";

  // If the URL points at an unknown root, scrub the param so reloads land
  // on the default rather than re-triggering the same fallback every render.
  useEffect(() => {
    if (requested && !validRequested) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete(TAB_PARAM);
          return next;
        },
        { replace: true }
      );
    }
  }, [requested, validRequested, setSearchParams]);

  const setActive = (name: string) => {
    if (!name || name === active) return;
    if (!roots.some((r) => r.name === name)) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        // Omit the param for the default root so the bare URL = default.
        if (roots[0]?.name === name) next.delete(TAB_PARAM);
        else next.set(TAB_PARAM, name);
        return next;
      },
      { replace: false }
    );
  };

  const activePath = roots.find((r) => r.name === active)?.path ?? "";

  return { active, roots, activePath, setActive };
}
