import { describe, it, expect } from "vitest";
import {
  listComments,
  createComment,
  setCommentStatus,
  editCommentBody,
  deleteComment,
  replyToComment,
} from "./comments";

// These exercise the sidecar-comment endpoints against the shared MSW handlers
// (src/test/mocks/handlers.ts), which also covers request-URL building
// (path encoding + root/id query params in both root and rootless forms).
describe("comments API client", () => {
  it("listComments returns the comments envelope for a file", async () => {
    const res = await listComments("docs/intro.md", "mock-root");
    expect(res.file).toBe("docs/intro.md");
    expect(res.root).toBe("mock-root");
    expect(Array.isArray(res.comments)).toBe(true);
    expect(res.summary.total).toBe(0);
  });

  it("listComments works without an explicit root", async () => {
    const res = await listComments("README.md");
    expect(res.file).toBe("README.md");
  });

  it("createComment posts the request body and returns the created comment", async () => {
    const created = await createComment(
      "docs/intro.md",
      {
        scope: "inline",
        body: "気になる",
        author: "alice",
        anchor: { heading_path: ["## Sec"], snippet: "text", occurrence: 0 },
      },
      "mock-root"
    );
    expect(created.id).toBe("c-001");
    expect(created.scope).toBe("inline");
    expect(created.body).toBe("気になる");
    expect(created.status).toBe("open");
    expect(created.anchor?.snippet).toBe("text");
  });

  it("setCommentStatus patches the status by id (with root)", async () => {
    const res = await setCommentStatus("docs/intro.md", "c-42", "resolved", "mock-root");
    expect(res.id).toBe("c-42");
    expect(res.status).toBe("resolved");
  });

  it("setCommentStatus works without an explicit root", async () => {
    const res = await setCommentStatus("README.md", "c-43", "open");
    expect(res.id).toBe("c-43");
    expect(res.status).toBe("open");
  });

  it("editCommentBody patches the body by id", async () => {
    const res = await editCommentBody("docs/intro.md", "c-44", "直した本文", "mock-root");
    expect(res.id).toBe("c-44");
    expect(res.body).toBe("直した本文");
  });

  it("editCommentBody works without an explicit root", async () => {
    const res = await editCommentBody("README.md", "c-45", "body2");
    expect(res.id).toBe("c-45");
  });

  it("deleteComment resolves on a 204 response", async () => {
    await expect(deleteComment("docs/intro.md", "c-46", "mock-root")).resolves.toBeUndefined();
  });

  it("deleteComment works without an explicit root", async () => {
    await expect(deleteComment("README.md", "c-47")).resolves.toBeUndefined();
  });

  it("replyToComment posts a reply and returns the updated comment", async () => {
    const res = await replyToComment(
      "docs/intro.md",
      "c-48",
      { author: "bob", body: "返信です" },
      "mock-root"
    );
    expect(res.id).toBe("c-48");
    expect(res.replies).toHaveLength(1);
    expect(res.replies?.[0]).toMatchObject({ author: "bob", body: "返信です" });
  });

  it("replyToComment works without an explicit root", async () => {
    const res = await replyToComment("README.md", "c-49", { body: "ok" });
    expect(res.id).toBe("c-49");
  });
});
