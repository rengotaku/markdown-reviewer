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
    const active = useOpenFiles
      .getState()
      .files.find((f) => f.id === activeId());
    expect(active?.markdown).toBe("# Changed");
    expect(active?.isDirty).toBe(true);
  });

  it("does not mark dirty when content is identical", () => {
    useOpenFiles.getState().addFiles([{ name: "a.md", root: ROOT, markdown: "# A" }]);
    useOpenFiles.getState().updateActiveMarkdown(ROOT, "# A");
    const active = useOpenFiles
      .getState()
      .files.find((f) => f.id === activeId());
    expect(active?.isDirty).toBe(false);
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
    useOpenFiles
      .getState()
      .addFiles([{ name: "a.md", root: ROOT, markdown: "# A" }]);
    useOpenFiles
      .getState()
      .overwriteFiles(ROOT, [
        { name: "missing.md", root: ROOT, markdown: "# X" },
      ]);
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
    expect(
      useOpenFiles
        .getState()
        .files.find((f) => f.id === activeId())!.isDirty
    ).toBe(true);

    useOpenFiles.getState().markActiveSaved(ROOT);
    expect(
      useOpenFiles
        .getState()
        .files.find((f) => f.id === activeId())!.isDirty
    ).toBe(false);
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

  it("closeFile only affects its own root's active id", () => {
    useOpenFiles
      .getState()
      .addFiles([{ name: "a.md", root: "works", markdown: "# A" }]);
    useOpenFiles
      .getState()
      .addFiles([{ name: "b.md", root: "rooms", markdown: "# B" }]);
    const worksId = useOpenFiles.getState().files.find((f) => f.root === "works")!.id;
    useOpenFiles.getState().closeFile(worksId);
    const state = useOpenFiles.getState();
    expect(state.activeIdByRoot.works).toBeNull();
    // rooms remains untouched.
    expect(state.activeIdByRoot.rooms).toBeTruthy();
    expect(state.files).toHaveLength(1);
    expect(state.files[0].root).toBe("rooms");
  });
});
