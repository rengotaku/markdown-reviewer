import { describe, it, expect } from "vitest";
import { splitPreamble, parseFrontmatter } from "./frontmatter";

const HINT = `<!-- markdown-reviewer
構造化コメント取得: GET http://localhost:15174/api/comments/foo.md?root=reviews
-->
`;

describe("splitPreamble", () => {
  it("returns the whole input as body when there is no preamble", () => {
    const raw = "# Title\n\nbody text\n";
    expect(splitPreamble(raw)).toEqual({
      preamble: "",
      frontmatterYaml: "",
      body: raw,
    });
  });

  it("splits a plain frontmatter block from the body", () => {
    const raw = "---\ndate: 2026-06-24\ntitle: Hello\n---\n# Title\n\nbody\n";
    const { preamble, frontmatterYaml, body } = splitPreamble(raw);
    expect(preamble).toBe("---\ndate: 2026-06-24\ntitle: Hello\n---\n");
    expect(frontmatterYaml).toBe("date: 2026-06-24\ntitle: Hello");
    expect(body).toBe("# Title\n\nbody\n");
    // Preamble + body reconstructs the original verbatim (roundtrip-safe).
    expect(preamble + body).toBe(raw);
  });

  it("peels the AI hint comment off before the frontmatter", () => {
    const raw = `${HINT}---\ndate: 2026-06-24\n---\n# Body\n`;
    const { preamble, frontmatterYaml, body } = splitPreamble(raw);
    expect(preamble).toBe(`${HINT}---\ndate: 2026-06-24\n---\n`);
    expect(frontmatterYaml).toBe("date: 2026-06-24");
    expect(body).toBe("# Body\n");
    expect(preamble + body).toBe(raw);
  });

  it("keeps the hint as preamble even when there is no frontmatter", () => {
    const raw = `${HINT}# Body only\n`;
    const { preamble, frontmatterYaml, body } = splitPreamble(raw);
    expect(preamble).toBe(HINT);
    expect(frontmatterYaml).toBe("");
    expect(body).toBe("# Body only\n");
  });

  it("does not treat a `---` thematic break in the body as frontmatter", () => {
    const raw = "# Title\n\nfoo\n\n---\n\nbar\n";
    expect(splitPreamble(raw).frontmatterYaml).toBe("");
    expect(splitPreamble(raw).body).toBe(raw);
  });
});

describe("parseFrontmatter", () => {
  it("returns [] for empty / whitespace-only yaml", () => {
    expect(parseFrontmatter("")).toEqual([]);
    expect(parseFrontmatter("   \n  ")).toEqual([]);
  });

  it("preserves key order for scalar values", () => {
    const entries = parseFrontmatter("date: 2026-06-24\ntitle: Hello");
    expect(entries).toEqual([
      { key: "date", value: "2026-06-24" },
      { key: "title", value: "Hello" },
    ]);
  });

  it("keeps date-like scalars as strings (JSON schema, not timestamps)", () => {
    const [entry] = parseFrontmatter("date: 2026-06-24");
    expect(typeof entry.value).toBe("string");
    expect(entry.value).toBe("2026-06-24");
  });

  it("parses flow and block sequences into arrays", () => {
    const entries = parseFrontmatter(
      "tags: [progress-report, infra]\naliases:\n  - a\n  - b"
    );
    expect(entries).toEqual([
      { key: "tags", value: ["progress-report", "infra"] },
      { key: "aliases", value: ["a", "b"] },
    ]);
  });

  it("treats an empty flow sequence as an empty array", () => {
    expect(parseFrontmatter("tags: []")).toEqual([{ key: "tags", value: [] }]);
  });

  it("ignores trailing YAML comments", () => {
    const entries = parseFrontmatter("tags: []          # 例: [a, b]");
    expect(entries).toEqual([{ key: "tags", value: [] }]);
  });

  it("returns [] when the document is not a mapping", () => {
    expect(parseFrontmatter("- just\n- a\n- list")).toEqual([]);
    expect(parseFrontmatter("just a scalar")).toEqual([]);
  });

  it("returns [] on malformed yaml instead of throwing", () => {
    expect(parseFrontmatter("key: [unterminated")).toEqual([]);
  });
});
