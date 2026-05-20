import { describe, it, expect, beforeEach } from "vitest";
import { useOpenFiles } from "./useOpenFiles";

describe("useOpenFiles", () => {
  beforeEach(() => {
    localStorage.clear();
    useOpenFiles.setState({ files: [], activeId: null });
  });

  it("starts with no files and no active id when reset", () => {
    const state = useOpenFiles.getState();
    expect(state.files).toEqual([]);
    expect(state.activeId).toBeNull();
  });

  it("adds files and activates the first added when none was active", () => {
    useOpenFiles.getState().addFiles([
      { name: "a.md", markdown: "# A" },
      { name: "b.md", markdown: "# B" },
    ]);
    const state = useOpenFiles.getState();
    expect(state.files).toHaveLength(2);
    expect(state.files[0].name).toBe("a.md");
    expect(state.activeId).toBe(state.files[0].id);
  });

  it("activates the first newly added file when adding more files", () => {
    useOpenFiles.getState().addFiles([{ name: "a.md", markdown: "# A" }]);
    useOpenFiles.getState().addFiles([{ name: "b.md", markdown: "# B" }]);
    const bId = useOpenFiles.getState().files.find((f) => f.name === "b.md")!.id;
    expect(useOpenFiles.getState().activeId).toBe(bId);
  });

  it("marks active file dirty on content change", () => {
    useOpenFiles.getState().addFiles([{ name: "a.md", markdown: "# A" }]);
    useOpenFiles.getState().updateActiveMarkdown("# Changed");
    const active = useOpenFiles
      .getState()
      .files.find((f) => f.id === useOpenFiles.getState().activeId);
    expect(active?.markdown).toBe("# Changed");
    expect(active?.isDirty).toBe(true);
  });

  it("does not mark dirty when content is identical", () => {
    useOpenFiles.getState().addFiles([{ name: "a.md", markdown: "# A" }]);
    useOpenFiles.getState().updateActiveMarkdown("# A");
    const active = useOpenFiles
      .getState()
      .files.find((f) => f.id === useOpenFiles.getState().activeId);
    expect(active?.isDirty).toBe(false);
  });

  it("switches active file", () => {
    useOpenFiles.getState().addFiles([
      { name: "a.md", markdown: "# A" },
      { name: "b.md", markdown: "# B" },
    ]);
    const secondId = useOpenFiles.getState().files[1].id;
    useOpenFiles.getState().setActive(secondId);
    expect(useOpenFiles.getState().activeId).toBe(secondId);
  });

  it("closes active file and activates the neighbor", () => {
    useOpenFiles.getState().addFiles([
      { name: "a.md", markdown: "# A" },
      { name: "b.md", markdown: "# B" },
      { name: "c.md", markdown: "# C" },
    ]);
    const [a, b, c] = useOpenFiles.getState().files;
    useOpenFiles.getState().setActive(b.id);
    useOpenFiles.getState().closeFile(b.id);
    const state = useOpenFiles.getState();
    expect(state.files.map((f) => f.id)).toEqual([a.id, c.id]);
    expect(state.activeId).toBe(c.id);
  });

  it("closing a non-active file keeps the active id", () => {
    useOpenFiles.getState().addFiles([
      { name: "a.md", markdown: "# A" },
      { name: "b.md", markdown: "# B" },
    ]);
    const [a, b] = useOpenFiles.getState().files;
    useOpenFiles.getState().setActive(a.id);
    useOpenFiles.getState().closeFile(b.id);
    const state = useOpenFiles.getState();
    expect(state.activeId).toBe(a.id);
    expect(state.files).toHaveLength(1);
  });

  it("auto-creates an untitled file when closing the last open file", () => {
    useOpenFiles.getState().addFiles([{ name: "a.md", markdown: "# A" }]);
    const id = useOpenFiles.getState().files[0].id;
    useOpenFiles.getState().closeFile(id);
    const state = useOpenFiles.getState();
    expect(state.files).toHaveLength(1);
    expect(state.files[0].name).toBe("untitled.md");
    expect(state.files[0].markdown).toBe("");
    expect(state.activeId).toBe(state.files[0].id);
  });

  it("overwriteFiles replaces markdown by name, resets dirty, bumps reloadToken", () => {
    useOpenFiles.getState().addFiles([
      { name: "a.md", markdown: "# A" },
      { name: "b.md", markdown: "# B" },
    ]);
    useOpenFiles.getState().updateActiveMarkdown("# A edited");
    const before = useOpenFiles.getState().files.find((f) => f.name === "a.md")!;

    useOpenFiles.getState().overwriteFiles([{ name: "a.md", markdown: "# A reloaded" }]);

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
      { name: "a.md", markdown: "# A" },
      { name: "b.md", markdown: "# B" },
    ]);
    const [a, b] = useOpenFiles.getState().files;
    useOpenFiles.getState().setActive(a.id);

    useOpenFiles.getState().overwriteFiles([{ name: "b.md", markdown: "# B reloaded" }]);

    expect(useOpenFiles.getState().activeId).toBe(b.id);
  });

  it("overwriteFiles keeps the active id when the already-active file is overwritten", () => {
    useOpenFiles.getState().addFiles([
      { name: "a.md", markdown: "# A" },
      { name: "b.md", markdown: "# B" },
    ]);
    const [a] = useOpenFiles.getState().files;
    useOpenFiles.getState().setActive(a.id);

    useOpenFiles.getState().overwriteFiles([{ name: "a.md", markdown: "# A reloaded" }]);

    expect(useOpenFiles.getState().activeId).toBe(a.id);
  });

  it("overwriteFiles ignores names not present in the store", () => {
    useOpenFiles.getState().addFiles([{ name: "a.md", markdown: "# A" }]);
    useOpenFiles.getState().overwriteFiles([{ name: "missing.md", markdown: "# X" }]);
    const state = useOpenFiles.getState();
    expect(state.files).toHaveLength(1);
    expect(state.files[0].markdown).toBe("# A");
  });

  it("closeAll replaces all files with a fresh untitled file", () => {
    useOpenFiles.getState().addFiles([
      { name: "a.md", markdown: "# A" },
      { name: "b.md", markdown: "# B" },
    ]);
    useOpenFiles.getState().closeAll();
    const state = useOpenFiles.getState();
    expect(state.files).toHaveLength(1);
    expect(state.files[0].name).toBe("untitled.md");
    expect(state.activeId).toBe(state.files[0].id);
  });

  it("createUntitled appends untitled.md and activates it", () => {
    useOpenFiles.getState().createUntitled();
    const state = useOpenFiles.getState();
    expect(state.files).toHaveLength(1);
    expect(state.files[0].name).toBe("untitled.md");
    expect(state.activeId).toBe(state.files[0].id);
  });

  it("createUntitled increments the suffix when names collide", () => {
    useOpenFiles.getState().addFiles([
      { name: "untitled.md", markdown: "" },
      { name: "untitled-2.md", markdown: "" },
    ]);
    useOpenFiles.getState().createUntitled();
    const names = useOpenFiles.getState().files.map((f) => f.name);
    expect(names).toEqual(["untitled.md", "untitled-2.md", "untitled-3.md"]);
  });
});
