import { describe, it, expect } from "vitest";
import { resolveInternalLink } from "./internalLink";

describe("resolveInternalLink", () => {
  it("resolves a same-directory relative link", () => {
    expect(resolveInternalLink("./foo.md", "dir/current.md")).toBe(
      "dir/foo.md"
    );
  });

  it("resolves a bare relative link (no leading ./)", () => {
    expect(resolveInternalLink("foo.md", "dir/current.md")).toBe(
      "dir/foo.md"
    );
  });

  it("resolves a parent-relative sibling link", () => {
    expect(resolveInternalLink("../sibling/bar.md", "dir/sub/current.md")).toBe(
      "dir/sibling/bar.md"
    );
  });

  it("resolves a root-absolute link", () => {
    expect(resolveInternalLink("/abs/in/root.md", "dir/current.md")).toBe(
      "abs/in/root.md"
    );
  });

  it("returns null when the link escapes the root", () => {
    expect(resolveInternalLink("../../etc/passwd", "dir/current.md")).toBeNull();
  });

  it("returns null for scheme-qualified URLs", () => {
    expect(resolveInternalLink("https://example.com/foo.md", "dir/current.md")).toBeNull();
    expect(resolveInternalLink("mailto:me@example.com", "dir/current.md")).toBeNull();
  });

  it("returns null for protocol-relative URLs", () => {
    expect(resolveInternalLink("//example.com/foo.md", "dir/current.md")).toBeNull();
  });

  it("returns null for pure in-page anchors", () => {
    expect(resolveInternalLink("#heading", "dir/current.md")).toBeNull();
  });

  it("returns null for empty href", () => {
    expect(resolveInternalLink("", "dir/current.md")).toBeNull();
  });

  it("drops a trailing fragment from a same-doc-relative link", () => {
    expect(resolveInternalLink("foo.md#sec", "dir/current.md")).toBe(
      "dir/foo.md"
    );
  });

  it("drops a trailing query string", () => {
    expect(resolveInternalLink("foo.md?x=1", "dir/current.md")).toBe(
      "dir/foo.md"
    );
  });

  it("decodes a URL-encoded file name", () => {
    expect(
      resolveInternalLink("%E6%97%A5%E6%9C%AC%E8%AA%9E.md", "dir/current.md")
    ).toBe("dir/日本語.md");
  });

  it("returns null when the whole link is just a fragment after dropping the query", () => {
    expect(resolveInternalLink("?x=1", "dir/current.md")).toBeNull();
  });

  it("resolves a link at the root file into a root file", () => {
    expect(resolveInternalLink("foo.md", "current.md")).toBe("foo.md");
  });

  it("returns null when at root and link tries to go above it", () => {
    expect(resolveInternalLink("../foo.md", "current.md")).toBeNull();
  });
});
