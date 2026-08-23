import { describe, it, expect } from "vitest";
import { buildCommentDeepLink } from "./deeplink";

describe("buildCommentDeepLink", () => {
  it("builds a comment deeplink URL with query parameters", () => {
    const got = buildCommentDeepLink("http://localhost:15174", "code", "foo.md", "c-001");
    expect(got).toBe("http://localhost:15174/?root=code&select_file=foo.md&comment_id=c-001");
  });

  it("escapes special characters in root, path and commentId", () => {
    const got = buildCommentDeepLink("http://localhost:15174/", "レビュー", "日本語/note v2.md", "c/001");
    expect(got).toContain("root=%E3%83%AC%E3%83%93%E3%83%A5%E3%83%BC");
    expect(got).toContain("select_file=%E6%97%A5%E6%9C%AC%E8%AA%9E%2Fnote+v2.md");
    expect(got).toContain("comment_id=c%2F001");
  });
});
