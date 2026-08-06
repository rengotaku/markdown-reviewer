import { describe, it, expect, beforeEach } from "vitest";
import { useChangedPaths } from "./useChangedPaths";

describe("useChangedPaths", () => {
  beforeEach(() => {
    useChangedPaths.setState({ changed: new Set(), selfWrites: new Set() });
  });

  it("mark/isChanged round-trip per root+path", () => {
    const { mark, isChanged } = useChangedPaths.getState();
    expect(isChanged("root-a", "a.md")).toBe(false);
    mark("root-a", "a.md");
    expect(isChanged("root-a", "a.md")).toBe(true);
    // A different root with the same path is a distinct key.
    expect(isChanged("root-b", "a.md")).toBe(false);
  });

  it("clear removes the mark and is a no-op when nothing was marked", () => {
    const { mark, clear, isChanged } = useChangedPaths.getState();
    mark("root-a", "a.md");
    clear("root-a", "a.md");
    expect(isChanged("root-a", "a.md")).toBe(false);
    // Clearing an unmarked path must not throw or mark it.
    clear("root-a", "never-marked.md");
    expect(isChanged("root-a", "never-marked.md")).toBe(false);
  });

  it("hasChangedUnder finds a marked descendant at any depth, scoped to root", () => {
    const { mark, hasChangedUnder } = useChangedPaths.getState();
    mark("root-a", "docs/api/spec.md");
    expect(hasChangedUnder("root-a", "docs")).toBe(true);
    expect(hasChangedUnder("root-a", "docs/api")).toBe(true);
    expect(hasChangedUnder("root-a", "docs/other")).toBe(false);
    expect(hasChangedUnder("root-b", "docs")).toBe(false);
  });

  it("hasChangedUnder does not match a sibling whose path merely shares a prefix", () => {
    const { mark, hasChangedUnder } = useChangedPaths.getState();
    // "docs-archive/x.md" must not count as being "under" "docs".
    mark("root-a", "docs-archive/x.md");
    expect(hasChangedUnder("root-a", "docs")).toBe(false);
  });

  // #178 round 3 (codex review, must-fix): renamed from consumeSelfWrite
  // (delete-on-match) to isSelfWrite (non-destructive) — a single save is
  // now echoed through multiple independent sources (SSE `tree` event + the
  // dir-listing poll for every open ancestor directory), so the signature
  // must survive repeated matching instead of being consumed by the first.
  it("isSelfWrite: a matching signature keeps matching on repeated checks", () => {
    const { registerSelfWrite, isSelfWrite } = useChangedPaths.getState();
    registerSelfWrite("root-a", "a.md", "2026-05-22T00:00:00Z");
    expect(isSelfWrite("root-a", "a.md", "2026-05-22T00:00:00Z")).toBe(true);
    // Not consumed — checking again must still match.
    expect(isSelfWrite("root-a", "a.md", "2026-05-22T00:00:00Z")).toBe(true);
  });

  it("isSelfWrite returns false for an mtime that was never registered", () => {
    const { isSelfWrite } = useChangedPaths.getState();
    expect(isSelfWrite("root-a", "a.md", "2026-05-22T00:00:00Z")).toBe(false);
  });

  // #178 round 2 (codex review, must-fix): `:`-joining let root `a:b` + path
  // `c.md` and root `a` + path `b:c.md` collide on the same key
  // (`a:b:c.md`), so marking one incorrectly marked the other too.
  it("does not collide root+path pairs that would share a key under `:`-joining", () => {
    const { mark, isChanged } = useChangedPaths.getState();
    mark("a:b", "c.md");
    expect(isChanged("a:b", "c.md")).toBe(true);
    // Would have been the exact same `:`-joined string ("a:b:c.md").
    expect(isChanged("a", "b:c.md")).toBe(false);

    mark("a", "b:c.md");
    expect(isChanged("a", "b:c.md")).toBe(true);
    // Marking the second pair must not have also marked the first.
    expect(isChanged("a:b", "c.md")).toBe(true);
  });
});
