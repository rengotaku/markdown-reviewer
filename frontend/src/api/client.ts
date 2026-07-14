import ky from "ky";
import { logger } from "../lib/logger";

// Exported so non-ky consumers (e.g. useServerEvents' EventSource, which ky
// doesn't wrap) can build the same base URL without duplicating the env
// lookup + fallback.
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080";

export const apiClient = ky.create({
  prefixUrl: API_BASE_URL,
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
