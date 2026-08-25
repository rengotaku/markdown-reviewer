import { beforeEach, describe, expect, it } from "vitest";
import { useRecentOpened, RECENT_OPENED_LIMIT } from "./useRecentOpened";

const ROOT = "works";

describe("useRecentOpened (#228)", () => {
  beforeEach(() => {
    localStorage.clear();
    useRecentOpened.setState({ entries: [] });
  });

  it("records the newest opened file first", () => {
    useRecentOpened.getState().record(ROOT, "a.md", "a.md");
    useRecentOpened.getState().record(ROOT, "docs/b.md", "b.md");

    expect(useRecentOpened.getState().listForRoot(ROOT).map((e) => e.path)).toEqual([
      "docs/b.md",
      "a.md",
    ]);
  });

  it("moves an already-recorded file to the front instead of duplicating it", () => {
    useRecentOpened.getState().record(ROOT, "a.md", "a.md");
    useRecentOpened.getState().record(ROOT, "b.md", "b.md");
    useRecentOpened.getState().record(ROOT, "a.md", "a.md");

    expect(useRecentOpened.getState().listForRoot(ROOT).map((e) => e.path)).toEqual([
      "a.md",
      "b.md",
    ]);
  });

  it(`keeps at most ${RECENT_OPENED_LIMIT} entries per root`, () => {
    for (let i = 0; i < RECENT_OPENED_LIMIT + 5; i++) {
      useRecentOpened.getState().record(ROOT, `f${i}.md`, `f${i}.md`);
    }
    const list = useRecentOpened.getState().listForRoot(ROOT);
    expect(list).toHaveLength(RECENT_OPENED_LIMIT);
    // Newest first, and the oldest five have fallen off the end.
    expect(list[0].path).toBe(`f${RECENT_OPENED_LIMIT + 4}.md`);
    expect(list.some((e) => e.path === "f0.md")).toBe(false);
  });

  it("keeps each root's history separate", () => {
    useRecentOpened.getState().record("works", "a.md", "a.md");
    useRecentOpened.getState().record("rooms", "b.md", "b.md");

    expect(useRecentOpened.getState().listForRoot("works").map((e) => e.path)).toEqual([
      "a.md",
    ]);
    expect(useRecentOpened.getState().listForRoot("rooms").map((e) => e.path)).toEqual([
      "b.md",
    ]);
  });

  it("ignores a record with no root or path", () => {
    useRecentOpened.getState().record("", "a.md", "a.md");
    useRecentOpened.getState().record(ROOT, "", "");
    expect(useRecentOpened.getState().entries).toHaveLength(0);
  });

  it("removes one file without touching the rest", () => {
    useRecentOpened.getState().record(ROOT, "a.md", "a.md");
    useRecentOpened.getState().record(ROOT, "b.md", "b.md");
    useRecentOpened.getState().remove(ROOT, "a.md");
    expect(useRecentOpened.getState().listForRoot(ROOT).map((e) => e.path)).toEqual([
      "b.md",
    ]);
  });

  it("persists the history across reloads", async () => {
    useRecentOpened.getState().record(ROOT, "a.md", "a.md");
    const stored = localStorage.getItem("markdown-reviewer-recent-opened");
    expect(stored).not.toBeNull();

    // Simulate a fresh page: wipe the in-memory state, put the persisted
    // payload back (setState would have overwritten it), then rehydrate.
    useRecentOpened.setState({ entries: [] });
    localStorage.setItem("markdown-reviewer-recent-opened", stored!);
    await useRecentOpened.persist.rehydrate();

    expect(useRecentOpened.getState().listForRoot(ROOT).map((e) => e.path)).toEqual([
      "a.md",
    ]);
  });
});
