import { describe, it, expect } from "vitest";
import {
  authorHue,
  authorInitials,
  isAiAuthored,
  relativeDate,
} from "./commentPresentation";

describe("commentPresentation", () => {
  it("marks only the ai author", () => {
    expect(isAiAuthored("ai")).toBe(true);
    expect(isAiAuthored("aiko")).toBe(false);
    expect(isAiAuthored(undefined)).toBe(false);
  });

  it("uses AI for the AI and a first character for people", () => {
    expect(authorInitials("ai")).toBe("AI");
    expect(authorInitials("alice")).toBe("A");
    expect(authorInitials("岸良")).toBe("岸");
    expect(authorInitials("")).toBe("?");
    expect(authorInitials(undefined)).toBe("?");
  });

  it("gives one author one hue, and different authors different ones", () => {
    expect(authorHue("alice")).toBe(authorHue("alice"));
    expect(authorHue("alice")).not.toBe(authorHue("bob"));
    expect(authorHue("alice")).toBeGreaterThanOrEqual(0);
    expect(authorHue("alice")).toBeLessThan(360);
  });

  it("reads a date as time elapsed, stopping at days", () => {
    const now = new Date(2026, 8, 2); // 2026-09-02
    expect(relativeDate("2026-09-02", now)).toBe("今日");
    // Later today is still 今日, never a negative count.
    expect(relativeDate("2026-09-03", now)).toBe("今日");
    expect(relativeDate("2026-09-01", now)).toBe("昨日");
    expect(relativeDate("2026-08-30", now)).toBe("3 日前");
    expect(relativeDate("2026-08-20", now)).toBe("1 週間前");
    expect(relativeDate("2026-07-02", now)).toBe("2 か月前");
    expect(relativeDate("2025-01-02", now)).toBe("1 年前");
  });

  it("passes through what it cannot read", () => {
    expect(relativeDate(undefined)).toBe("");
    expect(relativeDate("いつか")).toBe("いつか");
  });
});
