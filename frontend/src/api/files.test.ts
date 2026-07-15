import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import {
  ingestFile,
  listRevisions,
  getRevision,
  statFile,
  writeFile,
} from "./files";

const API_BASE = "http://localhost:8080";

// These exercise the managed-review endpoints against the shared MSW handlers
// (src/test/mocks/handlers.ts), which also covers the request-URL building
// (path encoding + root/id query params).
describe("review API client", () => {
  it("statFile surfaces the review lifecycle state", async () => {
    const res = await statFile("docs/intro.md", "mock-root");
    expect(res.state).toBe("draft");
  });

  it("ingestFile transitions a file to review state", async () => {
    const res = await ingestFile("docs/intro.md", "mock-root");
    expect(res.state).toBe("review");
    expect(res.path).toBe("docs/intro.md");
  });

  it("listRevisions returns a (possibly empty) revision list", async () => {
    const res = await listRevisions("docs/intro.md", "mock-root");
    expect(Array.isArray(res.revisions)).toBe(true);
  });

  it("getRevision fetches a single revision's content by id", async () => {
    const rev = await getRevision("docs/intro.md", "r-001", "mock-root");
    expect(rev.id).toBe("r-001");
    expect(rev.content).toContain("previous content");
  });

  it("getRevision works without an explicit root", async () => {
    const rev = await getRevision("README.md", "r-002");
    expect(rev.id).toBe("r-002");
  });

  it("writeFile tags the save with author=human alongside root", async () => {
    let captured = "";
    server.use(
      http.put(`${API_BASE}/api/files/*`, ({ request }) => {
        captured = request.url;
        return HttpResponse.json({
          path: "docs/intro.md",
          root: "mock-root",
          content: "# x",
          modified: "2026-05-20T00:00:00Z",
          created: "2026-05-19T00:00:00Z",
          state: "review",
        });
      })
    );

    await writeFile("docs/intro.md", "# x", "mock-root");
    const params = new URL(captured).searchParams;
    expect(params.get("root")).toBe("mock-root");
    expect(params.get("author")).toBe("human");
  });

  it("writeFile defaults author=human even without a root", async () => {
    let captured = "";
    server.use(
      http.put(`${API_BASE}/api/files/*`, ({ request }) => {
        captured = request.url;
        return HttpResponse.json({
          path: "README.md",
          root: "mock-root",
          content: "# x",
          modified: "2026-05-20T00:00:00Z",
          created: "2026-05-19T00:00:00Z",
          state: "review",
        });
      })
    );

    await writeFile("README.md", "# x");
    expect(new URL(captured).searchParams.get("author")).toBe("human");
  });

  it("writeFile sends an If-Match header when an ifMatch sha is given (#119)", async () => {
    let capturedIfMatch: string | null = null;
    server.use(
      http.put(`${API_BASE}/api/files/*`, ({ request }) => {
        capturedIfMatch = request.headers.get("If-Match");
        return HttpResponse.json({
          path: "docs/intro.md",
          root: "mock-root",
          content: "# x",
          modified: "2026-05-20T00:00:00Z",
          created: "2026-05-19T00:00:00Z",
          state: "review",
          sha: "sha-after-write",
        });
      })
    );

    const res = await writeFile("docs/intro.md", "# x", "mock-root", "human", "sha-before");
    expect(capturedIfMatch).toBe("sha-before");
    expect(res.sha).toBe("sha-after-write");
  });

  it("writeFile omits the If-Match header when no ifMatch sha is given", async () => {
    let capturedIfMatch: string | null | undefined;
    server.use(
      http.put(`${API_BASE}/api/files/*`, ({ request }) => {
        capturedIfMatch = request.headers.get("If-Match");
        return HttpResponse.json({
          path: "docs/intro.md",
          root: "mock-root",
          content: "# x",
          modified: "2026-05-20T00:00:00Z",
          created: "2026-05-19T00:00:00Z",
          state: "review",
        });
      })
    );

    await writeFile("docs/intro.md", "# x", "mock-root");
    expect(capturedIfMatch).toBeNull();
  });
});
