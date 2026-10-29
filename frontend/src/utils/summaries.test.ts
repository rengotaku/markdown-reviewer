import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SummaryItem } from "@/api";
import {
  readSummarySeen,
  referencedCommentIds,
  summaryTitle,
  unreadSummaryCount,
  writeSummarySeen,
} from "./summaries";

const item = (id: string): SummaryItem => ({
  id,
  sent_at: "2026-10-29T01:00:00Z",
  done_at: "2026-10-29T01:01:00Z",
  agent_id: "claude",
  session_name: "s",
  text: "t",
});

describe("summaryTitle", () => {
  it("prefers the first heading without its marks", () => {
    expect(summaryTitle("## **対応** した `c-001`\n\n本文")).toBe("対応 した c-001");
  });
  it("falls back to the first line and strips list/link marks", () => {
    expect(summaryTitle("\n- [見て](http://x) ください")).toBe("見て ください");
  });
  it("skips a leading code fence", () => {
    expect(summaryTitle("```sh\nls\n```\n結果です")).toBe("結果です");
  });
  it("is empty for empty text", () => {
    expect(summaryTitle("  \n")).toBe("");
  });
});

describe("referencedCommentIds", () => {
  it("keeps only ids that exist, once, in order", () => {
    expect(
      referencedCommentIds("c-2 と c-1、c-2 と c-99 と xc-1", new Set(["c-1", "c-2"]))
    ).toEqual(["c-2", "c-1"]);
  });
});

describe("unreadSummaryCount", () => {
  const list = [item("s-3"), item("s-2"), item("s-1")];
  it("counts summaries newer than the last seen one", () => {
    expect(unreadSummaryCount(list, "s-2")).toBe(1);
    expect(unreadSummaryCount(list, "s-3")).toBe(0);
  });
  it("counts all when nothing or an unknown id was seen", () => {
    expect(unreadSummaryCount(list, null)).toBe(3);
    expect(unreadSummaryCount(list, "s-0")).toBe(3);
  });
});

describe("seen storage", () => {
  beforeEach(() => localStorage.clear());
  it("round-trips per root and path", () => {
    writeSummarySeen("r", "a.md", "s-1");
    expect(readSummarySeen("r", "a.md")).toBe("s-1");
    expect(readSummarySeen("r", "b.md")).toBeNull();
  });
  it("survives a throwing localStorage", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readSummarySeen("r", "a.md")).toBeNull();
    expect(() => writeSummarySeen("r", "a.md", "s")).not.toThrow();
    spy.mockRestore();
    set.mockRestore();
  });
});
