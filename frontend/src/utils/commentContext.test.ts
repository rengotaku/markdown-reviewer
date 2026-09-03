import { describe, it, expect } from "vitest";
import type { CommentJSON } from "@/api";
import { contextLabel } from "./commentContext";

// A document with no headings has no heading stack, so the server used to send
// `"heading_path": null` and every reader that took the declared `string[]`
// contract at face value threw "Cannot read properties of null" (#262). The
// server now sends `[]`, but older sidecars on disk still hold null, so the
// label must degrade to the line range instead of throwing.
function comment(over: Partial<CommentJSON>): CommentJSON {
  return {
    id: "c-001",
    scope: "inline",
    body: "x",
    status: "open",
    ...over,
  } as CommentJSON;
}

describe("contextLabel", () => {
  it("falls back to the line range when context.heading_path is null", () => {
    const c = comment({
      context: { heading_path: null, line_range: [20, 20] },
    });
    expect(contextLabel(c)).toBe("L20");
  });

  it("keeps the heading when context.heading_path has one", () => {
    const c = comment({
      context: { heading_path: ["## 今日"], line_range: [7, 9] },
    });
    expect(contextLabel(c)).toBe("## 今日 (L7–9)");
  });

  it("reads an orphan's original target when its anchor has no heading_path", () => {
    const c = comment({
      orphan: true,
      anchor: { heading_path: null, snippet: "新規起票", occurrence: 0 },
    });
    expect(contextLabel(c)).toBe("新規起票（現在の本文には見つかりません）");
  });

  it("lists cross_section anchors that carry no heading_path", () => {
    const c = comment({
      scope: "cross_section",
      anchors: [
        { heading_path: null, snippet: "昨日", occurrence: 0 },
        { heading_path: ["## 今日"], snippet: "確定させる", occurrence: 0 },
      ],
    });
    expect(contextLabel(c)).toBe("昨日 ・ ## 今日");
  });
});
