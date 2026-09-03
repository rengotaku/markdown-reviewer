import { describe, it, expect, beforeEach } from "vitest";
import { useOpenFiles } from "./useOpenFiles";

// All tests pin a single root name so they keep exercising the same
// behaviors that mattered pre-multi-root, just routed through the per-root
// activeIdByRoot field.
const ROOT = "default";

function activeId() {
  return useOpenFiles.getState().activeIdByRoot[ROOT] ?? null;
}

describe("useOpenFiles", () => {
  beforeEach(() => {
    localStorage.clear();
    useOpenFiles.setState({ files: [], activeIdByRoot: {} });
  });

  it("starts with no files and no active id when reset", () => {
    const state = useOpenFiles.getState();
    expect(state.files).toEqual([]);
    expect(activeId()).toBeNull();
  });

  it("adds files and activates the first added when none was active", () => {
    useOpenFiles.getState().addFiles([
      { name: "a.md", root: ROOT, markdown: "# A" },
      { name: "b.md", root: ROOT, markdown: "# B" },
    ]);
    const state = useOpenFiles.getState();
    expect(state.files).toHaveLength(2);
    expect(state.files[0].name).toBe("a.md");
    expect(activeId()).toBe(state.files[0].id);
  });

  it("activates the first newly added file when adding more files", () => {
    useOpenFiles.getState().addFiles([{ name: "a.md", root: ROOT, markdown: "# A" }]);
    useOpenFiles.getState().addFiles([{ name: "b.md", root: ROOT, markdown: "# B" }]);
    const bId = useOpenFiles.getState().files.find((f) => f.name === "b.md")!.id;
    expect(activeId()).toBe(bId);
  });

  it("marks active file dirty on content change", () => {
    useOpenFiles.getState().addFiles([{ name: "a.md", root: ROOT, markdown: "# A" }]);
    useOpenFiles.getState().updateActiveMarkdown(ROOT, "# Changed");
    const active = useOpenFiles.getState().files.find((f) => f.id === activeId());
    expect(active?.markdown).toBe("# Changed");
    expect(active?.isDirty).toBe(true);
  });

  it("does not mark dirty when content is identical", () => {
    useOpenFiles.getState().addFiles([{ name: "a.md", root: ROOT, markdown: "# A" }]);
    useOpenFiles.getState().updateActiveMarkdown(ROOT, "# A");
    const active = useOpenFiles.getState().files.find((f) => f.id === activeId());
    expect(active?.isDirty).toBe(false);
  });

  // #265: markActiveDirty flips isDirty without touching `markdown` -- used
  // by TiptapEditor's onUpdate so the unsaved indicator reacts on every
  // keystroke even though the (expensive, on large docs) full Markdown
  // resync via updateActiveMarkdown is debounced.
  it("marks the active file dirty without changing markdown", () => {
    useOpenFiles.getState().addFiles([{ name: "a.md", root: ROOT, markdown: "# A" }]);
    useOpenFiles.getState().markActiveDirty(ROOT);
    const active = useOpenFiles.getState().files.find((f) => f.id === activeId());
    expect(active?.isDirty).toBe(true);
    expect(active?.markdown).toBe("# A");
  });

  it("markActiveDirty is a no-op (same object identity) once already dirty", () => {
    useOpenFiles.getState().addFiles([{ name: "a.md", root: ROOT, markdown: "# A" }]);
    useOpenFiles.getState().updateActiveMarkdown(ROOT, "# Changed");
    const filesBefore = useOpenFiles.getState().files;
    useOpenFiles.getState().markActiveDirty(ROOT);
    expect(useOpenFiles.getState().files).toBe(filesBefore);
  });

  it("markActiveDirty is a no-op when there is no active file for the root", () => {
    const before = useOpenFiles.getState();
    useOpenFiles.getState().markActiveDirty("no-such-root");
    expect(useOpenFiles.getState()).toBe(before);
  });

  it("switches active file", () => {
    useOpenFiles.getState().addFiles([
      { name: "a.md", root: ROOT, markdown: "# A" },
      { name: "b.md", root: ROOT, markdown: "# B" },
    ]);
    const secondId = useOpenFiles.getState().files[1].id;
    useOpenFiles.getState().setActive(ROOT, secondId);
    expect(activeId()).toBe(secondId);
  });

  it("closes active file and activates the neighbor", () => {
    useOpenFiles.getState().addFiles([
      { name: "a.md", root: ROOT, markdown: "# A" },
      { name: "b.md", root: ROOT, markdown: "# B" },
      { name: "c.md", root: ROOT, markdown: "# C" },
    ]);
    const [a, b, c] = useOpenFiles.getState().files;
    useOpenFiles.getState().setActive(ROOT, b.id);
    useOpenFiles.getState().closeFile(b.id);
    const state = useOpenFiles.getState();
    expect(state.files.map((f) => f.id)).toEqual([a.id, c.id]);
    expect(activeId()).toBe(c.id);
  });

  it("closing a non-active file keeps the active id", () => {
    useOpenFiles.getState().addFiles([
      { name: "a.md", root: ROOT, markdown: "# A" },
      { name: "b.md", root: ROOT, markdown: "# B" },
    ]);
    const [a, b] = useOpenFiles.getState().files;
    useOpenFiles.getState().setActive(ROOT, a.id);
    useOpenFiles.getState().closeFile(b.id);
    const state = useOpenFiles.getState();
    expect(activeId()).toBe(a.id);
    expect(state.files).toHaveLength(1);
  });

  it("closing the last open file leaves the store empty and unselected", () => {
    useOpenFiles.getState().addFiles([{ name: "a.md", root: ROOT, markdown: "# A" }]);
    const id = useOpenFiles.getState().files[0].id;
    useOpenFiles.getState().closeFile(id);
    const state = useOpenFiles.getState();
    expect(state.files).toEqual([]);
    expect(activeId()).toBeNull();
  });

  it("overwriteFiles replaces markdown by name, resets dirty, bumps reloadToken", () => {
    useOpenFiles.getState().addFiles([
      { name: "a.md", root: ROOT, markdown: "# A" },
      { name: "b.md", root: ROOT, markdown: "# B" },
    ]);
    useOpenFiles.getState().updateActiveMarkdown(ROOT, "# A edited");
    const before = useOpenFiles.getState().files.find((f) => f.name === "a.md")!;

    useOpenFiles
      .getState()
      .overwriteFiles(ROOT, [{ name: "a.md", root: ROOT, markdown: "# A reloaded" }]);

    const after = useOpenFiles.getState().files.find((f) => f.name === "a.md")!;
    expect(after.markdown).toBe("# A reloaded");
    expect(after.isDirty).toBe(false);
    expect(after.reloadToken).toBe(before.reloadToken + 1);
    const other = useOpenFiles.getState().files.find((f) => f.name === "b.md")!;
    expect(other.markdown).toBe("# B");
    expect(other.reloadToken).toBe(0);
  });

  it("overwriteFiles activates the first overwritten file when it was not active", () => {
    useOpenFiles.getState().addFiles([
      { name: "a.md", root: ROOT, markdown: "# A" },
      { name: "b.md", root: ROOT, markdown: "# B" },
    ]);
    const [a, b] = useOpenFiles.getState().files;
    useOpenFiles.getState().setActive(ROOT, a.id);

    useOpenFiles
      .getState()
      .overwriteFiles(ROOT, [{ name: "b.md", root: ROOT, markdown: "# B reloaded" }]);

    expect(activeId()).toBe(b.id);
  });

  it("overwriteFiles keeps the active id when the already-active file is overwritten", () => {
    useOpenFiles.getState().addFiles([
      { name: "a.md", root: ROOT, markdown: "# A" },
      { name: "b.md", root: ROOT, markdown: "# B" },
    ]);
    const [a] = useOpenFiles.getState().files;
    useOpenFiles.getState().setActive(ROOT, a.id);

    useOpenFiles
      .getState()
      .overwriteFiles(ROOT, [{ name: "a.md", root: ROOT, markdown: "# A reloaded" }]);

    expect(activeId()).toBe(a.id);
  });

  it("overwriteFiles ignores names not present in the store", () => {
    useOpenFiles.getState().addFiles([{ name: "a.md", root: ROOT, markdown: "# A" }]);
    useOpenFiles
      .getState()
      .overwriteFiles(ROOT, [{ name: "missing.md", root: ROOT, markdown: "# X" }]);
    const state = useOpenFiles.getState();
    expect(state.files).toHaveLength(1);
    expect(state.files[0].markdown).toBe("# A");
  });

  it("closeAll empties the store and clears the active id", () => {
    useOpenFiles.getState().addFiles([
      { name: "a.md", root: ROOT, markdown: "# A" },
      { name: "b.md", root: ROOT, markdown: "# B" },
    ]);
    useOpenFiles.getState().closeAll();
    const state = useOpenFiles.getState();
    expect(state.files).toEqual([]);
    expect(activeId()).toBeNull();
  });

  it("openServerFile adds and activates when path is new", () => {
    useOpenFiles.getState().openServerFile({
      name: "intro.md",
      path: "docs/intro.md",
      root: ROOT,
      markdown: "# Intro",
    });
    const state = useOpenFiles.getState();
    expect(state.files).toHaveLength(1);
    expect(state.files[0]).toMatchObject({
      name: "intro.md",
      path: "docs/intro.md",
      markdown: "# Intro",
      isDirty: false,
    });
    expect(activeId()).toBe(state.files[0].id);
  });

  it("openServerFile activates existing tab when path already open", () => {
    useOpenFiles
      .getState()
      .openServerFile({ name: "a.md", path: "a.md", root: ROOT, markdown: "# A" });
    useOpenFiles
      .getState()
      .openServerFile({ name: "b.md", path: "b.md", root: ROOT, markdown: "# B" });
    const aId = useOpenFiles.getState().files.find((f) => f.path === "a.md")!.id;

    useOpenFiles
      .getState()
      .openServerFile({ name: "a.md", path: "a.md", root: ROOT, markdown: "ignored" });

    const state = useOpenFiles.getState();
    expect(state.files).toHaveLength(2);
    expect(activeId()).toBe(aId);
    expect(state.files.find((f) => f.path === "a.md")!.markdown).toBe("# A");
  });

  it("markActiveSaved clears the dirty flag on the active file", () => {
    useOpenFiles.getState().addFiles([{ name: "a.md", root: ROOT, markdown: "# A" }]);
    useOpenFiles.getState().updateActiveMarkdown(ROOT, "# A edited");
    expect(useOpenFiles.getState().files.find((f) => f.id === activeId())!.isDirty).toBe(
      true
    );

    useOpenFiles.getState().markActiveSaved(ROOT);
    expect(useOpenFiles.getState().files.find((f) => f.id === activeId())!.isDirty).toBe(
      false
    );
  });

  // --- multi-root ---------------------------------------------------------

  it("tracks active id independently per root", () => {
    useOpenFiles
      .getState()
      .addFiles([{ name: "a.md", root: "works", markdown: "# works/a" }]);
    useOpenFiles
      .getState()
      .addFiles([{ name: "b.md", root: "rooms", markdown: "# rooms/b" }]);
    const state = useOpenFiles.getState();
    expect(state.activeIdByRoot.works).toBe(
      state.files.find((f) => f.root === "works")!.id
    );
    expect(state.activeIdByRoot.rooms).toBe(
      state.files.find((f) => f.root === "rooms")!.id
    );
  });

  it("does not persist open tabs to localStorage (#248)", () => {
    useOpenFiles.getState().addFiles([{ name: "a.md", root: "works", markdown: "# A" }]);
    expect(localStorage.getItem("markdown-reviewer-open-files")).toBeNull();
  });

  it("closeFile only affects its own root's active id", () => {
    useOpenFiles.getState().addFiles([{ name: "a.md", root: "works", markdown: "# A" }]);
    useOpenFiles.getState().addFiles([{ name: "b.md", root: "rooms", markdown: "# B" }]);
    const worksId = useOpenFiles.getState().files.find((f) => f.root === "works")!.id;
    useOpenFiles.getState().closeFile(worksId);
    const state = useOpenFiles.getState();
    expect(state.activeIdByRoot.works).toBeNull();
    // rooms remains untouched.
    expect(state.activeIdByRoot.rooms).toBeTruthy();
    expect(state.files).toHaveLength(1);
    expect(state.files[0].root).toBe("rooms");
  });

  it("closeOthers keeps only the target in its root and makes it active", () => {
    useOpenFiles.getState().addFiles([
      { name: "a.md", root: ROOT, markdown: "# A" },
      { name: "b.md", root: ROOT, markdown: "# B" },
      { name: "c.md", root: ROOT, markdown: "# C" },
    ]);
    const [, b] = useOpenFiles.getState().files;
    useOpenFiles.getState().closeOthers(b.id);
    const state = useOpenFiles.getState();
    expect(state.files.map((f) => f.name)).toEqual(["b.md"]);
    expect(activeId()).toBe(b.id);
  });

  it("closeOthers leaves other roots untouched", () => {
    useOpenFiles.getState().addFiles([{ name: "a.md", root: "works", markdown: "# A" }]);
    useOpenFiles.getState().addFiles([{ name: "x.md", root: "rooms", markdown: "# X" }]);
    const works = useOpenFiles.getState().files.find((f) => f.root === "works")!;
    useOpenFiles.getState().closeOthers(works.id);
    expect(useOpenFiles.getState().files.some((f) => f.root === "rooms")).toBe(true);
  });

  it("closeToRight closes only tabs after the target in order", () => {
    useOpenFiles.getState().addFiles([
      { name: "a.md", root: ROOT, markdown: "# A" },
      { name: "b.md", root: ROOT, markdown: "# B" },
      { name: "c.md", root: ROOT, markdown: "# C" },
    ]);
    const [, b, c] = useOpenFiles.getState().files;
    useOpenFiles.getState().setActive(ROOT, c.id);
    useOpenFiles.getState().closeToRight(b.id);
    const state = useOpenFiles.getState();
    expect(state.files.map((f) => f.name)).toEqual(["a.md", "b.md"]);
    // active was c (closed) → falls back to the target b.
    expect(activeId()).toBe(b.id);
  });

  it("closeToRight on the rightmost tab is a no-op", () => {
    useOpenFiles.getState().addFiles([
      { name: "a.md", root: ROOT, markdown: "# A" },
      { name: "b.md", root: ROOT, markdown: "# B" },
    ]);
    const [, b] = useOpenFiles.getState().files;
    useOpenFiles.getState().closeToRight(b.id);
    expect(useOpenFiles.getState().files).toHaveLength(2);
  });
});

describe("useOpenFiles guards and recovery", () => {
  beforeEach(() => {
    localStorage.clear();
    useOpenFiles.setState({ files: [], activeIdByRoot: {} });
  });

  it("addFiles / overwriteFiles with empty input are no-ops", () => {
    const before = useOpenFiles.getState();
    useOpenFiles.getState().addFiles([]);
    useOpenFiles.getState().overwriteFiles(ROOT, []);
    expect(useOpenFiles.getState().files).toBe(before.files);
  });

  it("mutators targeting unknown ids or inactive roots are no-ops", () => {
    useOpenFiles.getState().addFiles([{ name: "a.md", root: ROOT, markdown: "# A" }]);
    const before = useOpenFiles.getState().files;

    useOpenFiles.getState().setActive(ROOT, "missing-id");
    useOpenFiles.getState().closeFile("missing-id");
    useOpenFiles.getState().closeOthers("missing-id");
    useOpenFiles.getState().closeToRight("missing-id");
    useOpenFiles.getState().updateActiveMarkdown("other-root", "# X");
    useOpenFiles.getState().markActiveSaved("other-root");
    useOpenFiles.getState().discardActiveChanges("other-root");
    useOpenFiles.getState().applyExternalReload("missing-id", "# X", "2026-01-01T00:00:00Z");
    useOpenFiles.getState().acknowledgeExternalChange("missing-id", "2026-01-01T00:00:00Z");

    expect(useOpenFiles.getState().files).toEqual(before);
    expect(activeId()).toBe(before[0].id);
  });

  it("discardActiveChanges restores the saved baseline and bumps reloadToken", () => {
    useOpenFiles.getState().addFiles([{ name: "a.md", root: ROOT, markdown: "# A" }]);
    useOpenFiles.getState().updateActiveMarkdown(ROOT, "# dirty edit");
    expect(useOpenFiles.getState().files[0].isDirty).toBe(true);

    useOpenFiles.getState().discardActiveChanges(ROOT);
    const f = useOpenFiles.getState().files[0];
    expect(f.markdown).toBe("# A");
    expect(f.isDirty).toBe(false);
    expect(f.reloadToken).toBe(1);
  });

  it("applyExternalReload swaps content and records the new server mtime + sha", () => {
    useOpenFiles.getState().addFiles([{ name: "a.md", root: ROOT, markdown: "# A" }]);
    const id = useOpenFiles.getState().files[0].id;
    useOpenFiles
      .getState()
      .applyExternalReload(
        id,
        "# external",
        "2026-06-01T00:00:00Z",
        "2026-05-01T00:00:00Z",
        "sha-external"
      );
    const f = useOpenFiles.getState().files[0];
    expect(f.markdown).toBe("# external");
    expect(f.savedMarkdown).toBe("# external");
    expect(f.isDirty).toBe(false);
    expect(f.reloadToken).toBe(1);
    expect(f.serverModified).toBe("2026-06-01T00:00:00Z");
    expect(f.serverCreated).toBe("2026-05-01T00:00:00Z");
    expect(f.serverSha).toBe("sha-external");
  });

  it("acknowledgeExternalChange records the mtime (+ sha) without touching content", () => {
    useOpenFiles.getState().addFiles([{ name: "a.md", root: ROOT, markdown: "# A" }]);
    useOpenFiles.getState().updateActiveMarkdown(ROOT, "# keep my edit");
    const id = useOpenFiles.getState().files[0].id;
    useOpenFiles.getState().acknowledgeExternalChange(id, "2026-06-02T00:00:00Z", "sha-2");
    const f = useOpenFiles.getState().files[0];
    expect(f.serverModified).toBe("2026-06-02T00:00:00Z");
    expect(f.serverSha).toBe("sha-2");
    expect(f.markdown).toBe("# keep my edit");
    expect(f.isDirty).toBe(true);
  });

  it("acknowledgeExternalChange without a sha leaves the existing serverSha untouched", () => {
    useOpenFiles
      .getState()
      .addFiles([{ name: "a.md", root: ROOT, markdown: "# A", sha: "sha-1" }]);
    const id = useOpenFiles.getState().files[0].id;
    useOpenFiles.getState().acknowledgeExternalChange(id, "2026-06-02T00:00:00Z");
    expect(useOpenFiles.getState().files[0].serverSha).toBe("sha-1");
  });

  // --- ignoreExternalChange (#202) ------------------------------------------

  it("ignoreExternalChange keeps serverSha as the save baseline and records ignoredExternal", () => {
    useOpenFiles
      .getState()
      .addFiles([{ name: "a.md", root: ROOT, markdown: "# A", sha: "sha-base" }]);
    useOpenFiles.getState().updateActiveMarkdown(ROOT, "# keep my edit");
    const id = useOpenFiles.getState().files[0].id;

    useOpenFiles.getState().ignoreExternalChange(id, "2026-06-02T00:00:00Z", "sha-external");

    const f = useOpenFiles.getState().files[0];
    // The buffer was built on sha-base, so If-Match must still say sha-base —
    // otherwise the next save silently overwrites the external change.
    expect(f.serverSha).toBe("sha-base");
    expect(f.ignoredExternal?.sha).toBe("sha-external");
    expect(f.serverModified).toBe("2026-06-02T00:00:00Z");
    expect(f.markdown).toBe("# keep my edit");
    expect(f.isDirty).toBe(true);
  });

  it("clears ignoredExternal once the file is saved", () => {
    useOpenFiles
      .getState()
      .addFiles([{ name: "a.md", root: ROOT, markdown: "# A", sha: "sha-base" }]);
    const id = useOpenFiles.getState().files[0].id;
    useOpenFiles.getState().ignoreExternalChange(id, "2026-06-02T00:00:00Z", "sha-external");

    useOpenFiles
      .getState()
      .markActiveSaved(ROOT, "2026-06-03T00:00:00Z", undefined, "sha-saved");

    expect(useOpenFiles.getState().files[0].ignoredExternal).toBeUndefined();
  });

  it("clears ignoredExternal once an external reload is applied", () => {
    useOpenFiles
      .getState()
      .addFiles([{ name: "a.md", root: ROOT, markdown: "# A", sha: "sha-base" }]);
    const id = useOpenFiles.getState().files[0].id;
    useOpenFiles.getState().ignoreExternalChange(id, "2026-06-02T00:00:00Z", "sha-external");

    useOpenFiles
      .getState()
      .applyExternalReload(id, "# external", "2026-06-03T00:00:00Z", undefined, "sha-external");

    expect(useOpenFiles.getState().files[0].ignoredExternal).toBeUndefined();
  });

  it("clears ignoredExternal when the file returns to the acknowledged baseline", () => {
    useOpenFiles
      .getState()
      .addFiles([{ name: "a.md", root: ROOT, markdown: "# A", sha: "sha-base" }]);
    const id = useOpenFiles.getState().files[0].id;
    useOpenFiles.getState().ignoreExternalChange(id, "2026-06-02T00:00:00Z", "sha-external");

    // A plain touch / backfill goes through acknowledgeExternalChange, which
    // only happens when the on-disk content matches our baseline again.
    useOpenFiles.getState().acknowledgeExternalChange(id, "2026-06-04T00:00:00Z", "sha-base");

    expect(useOpenFiles.getState().files[0].ignoredExternal).toBeUndefined();
  });

  describe("reorderFiles", () => {
    function names() {
      return useOpenFiles
        .getState()
        .files.filter((f) => f.root === ROOT)
        .map((f) => f.name);
    }

    beforeEach(() => {
      useOpenFiles.getState().addFiles([
        { name: "a.md", root: ROOT, markdown: "# A" },
        { name: "b.md", root: ROOT, markdown: "# B" },
        { name: "c.md", root: ROOT, markdown: "# C" },
      ]);
    });

    it("moves a tab to the right", () => {
      useOpenFiles.getState().reorderFiles(ROOT, 0, 2);
      expect(names()).toEqual(["b.md", "c.md", "a.md"]);
    });

    it("moves a tab to the left", () => {
      useOpenFiles.getState().reorderFiles(ROOT, 2, 0);
      expect(names()).toEqual(["c.md", "a.md", "b.md"]);
    });

    it("is a no-op when from === to", () => {
      useOpenFiles.getState().reorderFiles(ROOT, 1, 1);
      expect(names()).toEqual(["a.md", "b.md", "c.md"]);
    });

    it("is a no-op when an index is out of range", () => {
      useOpenFiles.getState().reorderFiles(ROOT, 0, 9);
      expect(names()).toEqual(["a.md", "b.md", "c.md"]);
    });

    it("leaves other roots' files untouched", () => {
      useOpenFiles
        .getState()
        .addFiles([{ name: "x.md", root: "other", markdown: "# X" }]);
      useOpenFiles.getState().reorderFiles(ROOT, 0, 2);
      const other = useOpenFiles
        .getState()
        .files.filter((f) => f.root === "other")
        .map((f) => f.name);
      expect(names()).toEqual(["b.md", "c.md", "a.md"]);
      expect(other).toEqual(["x.md"]);
    });
  });
});
