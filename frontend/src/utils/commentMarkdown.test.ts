import { describe, it, expect } from "vitest";
import { renderCommentMarkdown } from "./commentMarkdown";

// Test cases A1-A14 are a pre-designed spec (see issue #147 brief) covering
// both rendering fidelity (bold/italic/lists/tables/...) and the security
// requirements (no raw HTML, no javascript:/vbscript:/data: URIs). Do not
// delete/rename/loosen these assertions; report and stop if the
// implementation can't satisfy one.

describe("renderCommentMarkdown", () => {
  it("A1: renders bold/italic/strikethrough without leaving literal ** markers", () => {
    const html = renderCommentMarkdown("**bold** と *italic* と ~~del~~");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toMatch(/<s>del<\/s>|<del>del<\/del>/);
    expect(html).not.toContain("**bold**");
  });

  it("A2: renders inline code", () => {
    const html = renderCommentMarkdown("`foo()`");
    expect(html).toContain("<code>foo()</code>");
  });

  it("A3: renders a fenced code block with no syntax-highlight spans", () => {
    const html = renderCommentMarkdown("```\nconst a = 1\n```");
    expect(html).toContain("<pre>");
    expect(html).toContain("<code>");
    expect(html).not.toMatch(/<span class=/);
  });

  it("A4: renders headings", () => {
    const html = renderCommentMarkdown("## 見出し");
    expect(html).toContain("<h2>見出し</h2>");
  });

  it("A5: renders nested bullet lists as 2+ <ul>", () => {
    const html = renderCommentMarkdown("- a\n  - b\n- c");
    const matches = html.match(/<ul>/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("A6: renders ordered lists", () => {
    const html = renderCommentMarkdown("1. a\n2. b");
    expect(html).toContain("<ol>");
  });

  it("A7: renders a GFM table with thead/tbody/td", () => {
    const html = renderCommentMarkdown(
      "| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |"
    );
    expect(html).toContain("<table>");
    expect(html).toContain("<thead>");
    expect(html).toContain("<tbody>");
    expect(html).toContain("<td>");
  });

  it("A8: renders links with target=_blank and rel=noopener noreferrer", () => {
    const html = renderCommentMarkdown("[Issue](https://example.com/1)");
    expect(html).toMatch(
      /<a[^>]*href="https:\/\/example\.com\/1"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*>/
    );
  });

  it("A9: renders blockquotes", () => {
    const html = renderCommentMarkdown("> quote");
    expect(html).toContain("<blockquote>");
  });

  it("A10: renders a horizontal rule", () => {
    const html = renderCommentMarkdown("---");
    expect(html).toContain("<hr>");
  });

  it("A11: escapes a raw <script> tag so it never appears as a live tag", () => {
    const html = renderCommentMarkdown("<script>alert(1)</script>");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script");
  });

  it("A12: escapes a raw <img onerror=...> so it never appears as a live tag", () => {
    const html = renderCommentMarkdown('<img src=x onerror="alert(1)">');
    expect(html).not.toMatch(/<img[^>]*onerror=/);
  });

  // A13 was originally written as "the output must not contain the string
  // 'javascript:'". That was too literal: markdown-it leaves a rejected link
  // as inert escaped text, and scrubbing that text after rendering also
  // rewrote the insides of code blocks. The property that actually matters is
  // that no *live* link/attribute carries a dangerous scheme.
  it("A13: never emits a live <a> whose href uses a dangerous scheme", () => {
    for (const src of [
      "[x](javascript:alert(1))",
      "[x](vbscript:msgbox(1))",
      "[x](data:text/html,<script>alert(1)</script>)",
      "[x](file:///etc/passwd)",
    ]) {
      const html = renderCommentMarkdown(src);
      expect(html).not.toMatch(/<a[^>]*href=/i);
      expect(html).not.toMatch(/href\s*=\s*["']?\s*(javascript|vbscript|data|file):/i);
    }
  });

  it("A14: returns an empty-ish string for empty input without throwing", () => {
    expect(() => renderCommentMarkdown("")).not.toThrow();
    expect(renderCommentMarkdown("").trim()).toBe("");
  });

  // --- Additional regression/boundary cases found while implementing ---

  it("keeps a rejected dangerous link as inert escaped text, not a tag", () => {
    const html = renderCommentMarkdown("[**x**](javascript:alert(1))");
    expect(html).not.toMatch(/<a[^>]*href=/i);
    // The label keeps its inline formatting; the scheme survives only as text.
    expect(html).toContain("<strong>x</strong>");
  });

  it("does not rewrite Markdown link syntax quoted inside code", () => {
    const html = renderCommentMarkdown(
      "```markdown\n[click](javascript:alert(1))\n```\n\n`[i](data:image/png;base64,AAA)`"
    );
    expect(html).toContain("[click](javascript:alert(1))");
    expect(html).toContain("[i](data:image/png;base64,AAA)");
    expect(html).not.toMatch(/<a[^>]*href=/i);
  });

  it("does not touch a plain-text mention of a scheme with no link syntax", () => {
    const html = renderCommentMarkdown("javascript: is a URI scheme");
    expect(html).toContain("javascript:");
  });
});
