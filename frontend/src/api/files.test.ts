import { describe, it, expect } from "vitest";
import { ingestFile, listRevisions, getRevision, statFile } from "./files";

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
});
