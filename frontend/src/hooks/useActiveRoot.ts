import { useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useConfig } from "@/hooks/useConfig";
import type { ReviewRootEntry } from "@/api";

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
 * Source of truth is the URL's first path segment (`/:root/...`), read via
 * React Router's `useParams`. Switching roots pushes a new `/{name}` — the
 * previously open file's path is dropped in the process since it isn't
 * valid under a different root (see `setActive`).
 */
export function useActiveRoot(): UseActiveRootResult {
  const { root: routeRoot } = useParams<{ root?: string }>();
  const navigate = useNavigate();
  const { data: config } = useConfig();

  const roots = useMemo<ReviewRootEntry[]>(
    () => config?.review_roots ?? [],
    [config]
  );

  // react-router's `useParams` already percent-decodes segment values (its
  // `matchRoutes` normalizes them before this hook ever sees them) — do NOT
  // decode again here. A root name containing a literal `%` (e.g. the URL
  // segment `100%25done`) round-trips to `useParams` as `100%done`, and
  // re-running `decodeURIComponent` on that throws `URIError: URI
  // malformed` (`%do` isn't a valid escape), crashing the whole page.
  const requested = routeRoot ?? "";
  // Reject URL values that don't match a known root so the rest of the UI
  // doesn't have to handle a phantom selection.
  const validRequested = roots.some((r) => r.name === requested)
    ? requested
    : "";
  const active = validRequested || roots[0]?.name || "";

  // If the URL points at an unknown root, bounce to the default rather than
  // rendering with a phantom selection. Skipped while config is still
  // loading (`roots` empty) — nothing is "unknown" yet at that point.
  useEffect(() => {
    if (roots.length === 0) return;
    if (requested && !validRequested) {
      navigate(`/${encodeURIComponent(roots[0]?.name ?? "")}`, { replace: true });
    }
  }, [requested, validRequested, roots, navigate]);

  const setActive = (name: string) => {
    if (!name || name === active) return;
    if (!roots.some((r) => r.name === name)) return;
    // The open file path belongs to the *previous* root; there is nothing
    // meaningful to carry over, so this is a plain root-only URL.
    navigate(`/${encodeURIComponent(name)}`);
  };

  const activePath = roots.find((r) => r.name === active)?.path ?? "";

  return { active, roots, activePath, setActive };
}
