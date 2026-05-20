import { describe, it, expect } from "vitest";
import { buildFileTree } from "./buildFileTree";

const entry = (path: string) => ({ path, size: 1, modified: "2026-05-20T00:00:00Z" });

describe("buildFileTree", () => {
  it("returns empty array for empty input", () => {
    expect(buildFileTree([])).toEqual([]);
  });

  it("places top-level files at root", () => {
    const tree = buildFileTree([entry("a.md"), entry("b.md")]);
    expect(tree).toHaveLength(2);
    expect(tree[0]).toMatchObject({ type: "file", name: "a.md", path: "a.md" });
    expect(tree[1]).toMatchObject({ type: "file", name: "b.md", path: "b.md" });
  });

  it("reconstructs nested directories", () => {
    const tree = buildFileTree([
      entry("docs/intro.md"),
      entry("docs/api/spec.md"),
      entry("README.md"),
    ]);

    expect(tree).toHaveLength(2);
    // dir first
    const [docs, readme] = tree;
    expect(docs).toMatchObject({ type: "dir", name: "docs", path: "docs" });
    expect(readme).toMatchObject({ type: "file", name: "README.md", path: "README.md" });

    expect(docs.children).toHaveLength(2);
    const [apiDir, introFile] = docs.children!;
    expect(apiDir).toMatchObject({ type: "dir", name: "api", path: "docs/api" });
    expect(introFile).toMatchObject({
      type: "file",
      name: "intro.md",
      path: "docs/intro.md",
    });

    expect(apiDir.children).toHaveLength(1);
    expect(apiDir.children![0]).toMatchObject({
      type: "file",
      name: "spec.md",
      path: "docs/api/spec.md",
    });
  });

  it("sorts dirs before files and alphabetises", () => {
    const tree = buildFileTree([
      entry("z.md"),
      entry("alpha/a.md"),
      entry("a.md"),
      entry("beta/b.md"),
    ]);
    const names = tree.map((n) => n.name);
    expect(names).toEqual(["alpha", "beta", "a.md", "z.md"]);
  });

  it("ignores empty path segments from leading slashes", () => {
    const tree = buildFileTree([entry("/foo.md")]);
    expect(tree).toEqual([{ type: "file", name: "foo.md", path: "/foo.md" }]);
  });
});
