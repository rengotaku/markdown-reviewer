import ky from "ky";
import { logger } from "../lib/logger";

// Exported so non-ky consumers (e.g. useServerEvents' EventSource, which ky
// doesn't wrap) can build the same base URL without duplicating the env
// lookup + fallback.
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080";

// ky only concatenates `prefixUrl` onto request paths ("api/config") when
// it's truthy — an empty API_BASE_URL (same-origin production build, see
// .env.production) would otherwise leave the path unresolved as a bare
// relative string, which the platform then resolves against whatever the
// current *page* path is (e.g. "/reviews/foo.md" + "api/config" ->
// ".../reviews/api/config" -> wrong endpoint entirely) instead of the site
// root (#236 regression: path-style file URLs broke same-origin API calls
// that used to work by accident when every page was "/").
//
// `window.location.origin` (no path) is used rather than a bare "/" so the
// prefix is always a fully-qualified absolute URL — the same shape as the
// explicit-base case above — which keeps behavior identical between "no
// env var set" (dev/test) and "env var explicitly empty" (prod same-
// origin), and is what makes this actually testable: a fully-qualified URL
// is independent of the current document path in every environment,
// browser or not.
function resolveApiPrefix(base: string): string {
  if (base) return base;
  return typeof window !== "undefined" && window.location?.origin
    ? window.location.origin
    : "/";
}

export const apiClient = ky.create({
  prefixUrl: resolveApiPrefix(API_BASE_URL),
  headers: {
    "Content-Type": "application/json",
  },
  hooks: {
    beforeError: [
      async (error) => {
        const { response } = error;
        if (response) {
          try {
            const body = await response.json();
            const message =
              (body as { message?: string; error?: string }).message ||
              (body as { error?: string }).error ||
              error.message;
            logger.error(`API ${response.url} failed: ${response.status}`, message);
            error.message = message;
          } catch {
            logger.warn(`Failed to parse error response: ${response.url}`);
          }
        } else {
          logger.error("Network request failed", error.message);
        }
        return error;
      },
    ],
  },
});
