import { describe, it, expect } from "vitest";
import { stripHint } from "./stripHint";

describe("stripHint", () => {
  it("removes a leading markdown-reviewer hint block and following blanks", () => {
    const withHint = [
      "<!-- markdown-reviewer",
      "このファイルには @comment レビューマーカーが含まれる可能性があります。",
      "構造化コメント取得: GET http://localhost:8080/api/comments/doc.md?root=rooms",
      "API 全仕様:        GET http://localhost:8080/api/help",
      "-->",
      "",
      "# Title",
      "",
      "body",
    ].join("\n");
    expect(stripHint(withHint)).toBe("# Title\n\nbody");
  });

  it("leaves hint-free content untouched", () => {
    const plain = "# Title\n\nbody\n";
    expect(stripHint(plain)).toBe(plain);
  });

  it("only strips a hint at the very start, not mid-document", () => {
    const mid = "# Title\n\n<!-- markdown-reviewer\nGET ...\n-->\n";
    expect(stripHint(mid)).toBe(mid);
  });
});
