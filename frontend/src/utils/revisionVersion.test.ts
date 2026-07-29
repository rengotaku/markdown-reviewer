import { describe, it, expect } from "vitest";
import { parseRevisionId, computeDisplayVersion } from "./revisionVersion";

describe("parseRevisionId", () => {
  it("parses the numeric suffix of a well-formed r-NNN id", () => {
    expect(parseRevisionId("r-003")).toBe(3);
    expect(parseRevisionId("r-021")).toBe(21);
  });

  it("returns null for ids that don't match the r-NNN shape", () => {
    expect(parseRevisionId("weird")).toBeNull();
    expect(parseRevisionId("")).toBeNull();
  });
});

describe("computeDisplayVersion", () => {
  it("returns 1 for a draft file with no revisions", () => {
    expect(computeDisplayVersion([], undefined, "anything")).toBe(1);
  });

  it("returns newest id + 1 when the newest content differs from the current text (browser-save path)", () => {
    // revisions[0] is newest-first per ListRevisions. PUT /api/files snapshots
    // the *pre-save* body, so the newest revision's content is stale relative
    // to what's on screen now.
    expect(
      computeDisplayVersion(
        [{ id: "r-003" }, { id: "r-002" }, { id: "r-001" }],
        "old content",
        "new content"
      )
    ).toBe(4);
  });

  it("returns the newest id as-is when its content matches the current text (external-edit path)", () => {
    // SyncExternalEdit appends the *current* body verbatim, so the newest
    // revision already equals what's on screen — no +1.
    expect(
      computeDisplayVersion(
        [{ id: "r-003" }, { id: "r-002" }, { id: "r-001" }],
        "same content",
        "same content"
      )
    ).toBe(3);
  });

  it("treats an undefined newest content (not yet fetched) as not matching", () => {
    expect(
      computeDisplayVersion([{ id: "r-003" }], undefined, "current text")
    ).toBe(4);
  });

  it("stays correct past the MaxRevisions=20 trim, browser-save path (#143 codex review round 2)", () => {
    // Only the newest retained revision is returned (history.jsonl trimmed
    // history), but its id keeps climbing past 20 since nextID() derives from
    // the max retained id, not the count.
    expect(
      computeDisplayVersion([{ id: "r-021" }], "old content", "new content")
    ).toBe(22);
  });

  it("stays correct past the MaxRevisions=20 trim, external-edit path (#143 codex review round 3)", () => {
    expect(
      computeDisplayVersion([{ id: "r-021" }], "same content", "same content")
    ).toBe(21);
  });

  it("falls back to revisions.length + 1 when the newest id fails to parse and content doesn't match", () => {
    expect(
      computeDisplayVersion(
        [{ id: "weird" }, { id: "r-001" }],
        "old content",
        "new content"
      )
    ).toBe(3);
  });

  it("falls back to revisions.length when the newest id fails to parse but content matches", () => {
    expect(
      computeDisplayVersion(
        [{ id: "weird" }, { id: "r-001" }],
        "same content",
        "same content"
      )
    ).toBe(2);
  });
});
