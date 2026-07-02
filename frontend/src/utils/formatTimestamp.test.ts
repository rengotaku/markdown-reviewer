import { describe, it, expect } from "vitest";
import { formatLocalTimestamp } from "./formatTimestamp";

describe("formatLocalTimestamp", () => {
  it("renders an RFC3339 timestamp as local YYYY/MM/DD HH:mm", () => {
    const out = formatLocalTimestamp("2026-05-20T09:30:00Z");
    // Exact wall-clock depends on the runner's TZ; assert shape + roundtrip.
    expect(out).toMatch(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/);
    const d = new Date("2026-05-20T09:30:00Z");
    const expected = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(
      d.getDate()
    ).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(
      d.getMinutes()
    ).padStart(2, "0")}`;
    expect(out).toBe(expected);
  });

  it("returns empty string for empty input", () => {
    expect(formatLocalTimestamp("")).toBe("");
  });

  it("returns empty string for unparseable input", () => {
    expect(formatLocalTimestamp("not-a-date")).toBe("");
  });
});
