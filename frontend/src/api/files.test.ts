import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import {
  ingestFile,
  listRevisions,
  getRevision,
  statFile,
  statBatch,
  STAT_BATCH_LIMIT,
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

// #174: the review-badge sweep used to fire one statFile per open tab in
// parallel, saturating the browser's 6-connections-per-origin budget.
describe("statBatch", () => {
  it("returns one result per requested file, keyed by root and path", async () => {
    const results = await statBatch([
      { root: "mock-root", path: "docs/intro.md" },
      { root: "other", path: "docs/open.md" },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      root: "mock-root",
      path: "docs/intro.md",
      hasOpenComments: false,
    });
    expect(results[1]).toMatchObject({
      root: "other",
      path: "docs/open.md",
      hasOpenComments: true,
    });
  });

  it("surfaces per-item not_found instead of throwing", async () => {
    const results = await statBatch([
      { root: "mock-root", path: "docs/missing.md" },
      { root: "mock-root", path: "docs/intro.md" },
    ]);

    expect(results[0].error).toBe("not_found");
    expect(results[1].error).toBeUndefined();
  });

  it("sends a single request for a batch within the limit", async () => {
    let calls = 0;
    server.use(
      http.post(`${API_BASE}/api/stat/batch`, async ({ request }) => {
        calls += 1;
        const body = (await request.json()) as { files: { path: string }[] };
        return HttpResponse.json({
          results: body.files.map((f) => ({
            root: "mock-root",
            path: f.path,
            state: "draft",
            hasOpenComments: false,
          })),
        });
      })
    );

    const files = Array.from({ length: STAT_BATCH_LIMIT }, (_, i) => ({
      root: "mock-root",
      path: `f${i}.md`,
    }));
    const results = await statBatch(files);

    expect(calls).toBe(1);
    expect(results).toHaveLength(STAT_BATCH_LIMIT);
  });

  // The server rejects oversized batches, so the client splits rather than
  // letting a large tab set fail the whole sweep.
  it("splits batches over the limit and concatenates in request order", async () => {
    const chunkSizes: number[] = [];
    server.use(
      http.post(`${API_BASE}/api/stat/batch`, async ({ request }) => {
        const body = (await request.json()) as { files: { path: string }[] };
        chunkSizes.push(body.files.length);
        return HttpResponse.json({
          results: body.files.map((f) => ({
            root: "mock-root",
            path: f.path,
            state: "draft",
            hasOpenComments: false,
          })),
        });
      })
    );

    const total = STAT_BATCH_LIMIT + 3;
    const files = Array.from({ length: total }, (_, i) => ({
      root: "mock-root",
      path: `f${i}.md`,
    }));
    const results = await statBatch(files);

    expect(chunkSizes).toEqual([STAT_BATCH_LIMIT, 3]);
    expect(results).toHaveLength(total);
    expect(results[0].path).toBe("f0.md");
    expect(results[total - 1].path).toBe(`f${total - 1}.md`);
  });

  it("returns an empty array without calling the server for no files", async () => {
    let calls = 0;
    server.use(
      http.post(`${API_BASE}/api/stat/batch`, () => {
        calls += 1;
        return HttpResponse.json({ results: [] });
      })
    );

    expect(await statBatch([])).toEqual([]);
    expect(calls).toBe(0);
  });
});
