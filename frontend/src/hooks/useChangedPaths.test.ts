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

  it("registerSelfWrite + consumeSelfWrite: matching signature is consumed exactly once", () => {
    const { registerSelfWrite, consumeSelfWrite } = useChangedPaths.getState();
    registerSelfWrite("root-a", "a.md", "2026-05-22T00:00:00Z");
    expect(consumeSelfWrite("root-a", "a.md", "2026-05-22T00:00:00Z")).toBe(true);
    // Consumed — a second check for the exact same signature must fail now.
    expect(consumeSelfWrite("root-a", "a.md", "2026-05-22T00:00:00Z")).toBe(false);
  });

  it("consumeSelfWrite returns false for an mtime that was never registered", () => {
    const { consumeSelfWrite } = useChangedPaths.getState();
    expect(consumeSelfWrite("root-a", "a.md", "2026-05-22T00:00:00Z")).toBe(false);
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
