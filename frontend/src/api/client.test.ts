import { describe, it, expect, afterEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";

describe("apiClient prefixUrl resolution (#236 regression)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("resolves API requests against the site origin, not the current document path, when VITE_API_BASE_URL is unset/empty", async () => {
    // .env.production ships VITE_API_BASE_URL="" for same-origin deploys.
    // The bug (#236) only reproduced once the *document's own* path was a
    // path-style file route rather than "/" — a bare relative `prefixUrl`
    // silently resolves "api/config" against whatever page you're on
    // instead of the site root.
    vi.stubEnv("VITE_API_BASE_URL", "");
    vi.resetModules();
    const { apiClient } = await import("./client");

    window.history.pushState(
      null,
      "",
      "/reviews/daily%2F2026-08-26%2Fprogress-report.md"
    );

    let capturedUrl: string | undefined;
    server.use(
      http.get("*/api/config", ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({
          review_root_name: "reviews",
          review_root: "/tmp/reviews",
          review_roots: [{ name: "reviews", path: "/tmp/reviews" }],
        });
      })
    );

    await apiClient.get("api/config").json();

    // Must land on "/api/config" under the page's origin — not
    // ".../reviews/daily%2F.../api/config" (the #236 regression) and not a
    // bare unresolved relative string either.
    expect(capturedUrl).toBe(`${window.location.origin}/api/config`);
  });

  it("still uses the explicit base URL untouched when VITE_API_BASE_URL is set (unchanged dev/test behavior)", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "http://localhost:9999");
    vi.resetModules();
    const { apiClient, API_BASE_URL } = await import("./client");
    expect(API_BASE_URL).toBe("http://localhost:9999");

    let capturedUrl: string | undefined;
    server.use(
      http.get("http://localhost:9999/api/config", ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({
          review_root_name: "x",
          review_root: "/tmp/x",
          review_roots: [{ name: "x", path: "/tmp/x" }],
        });
      })
    );

    await apiClient.get("api/config").json();

    expect(capturedUrl).toBe("http://localhost:9999/api/config");
  });
});
