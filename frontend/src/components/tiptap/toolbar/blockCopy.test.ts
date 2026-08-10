import { describe, it, expect } from "vitest";
import { codeTextOf, findCopyableBlock } from "./blockCopy";

function html(markup: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = markup;
  return host;
}

describe("findCopyableBlock", () => {
  it("finds the enclosing code block from a token span", () => {
    const host = html(
      '<pre><code><span class="hljs-keyword" id="tok">const</span> x = 1</code></pre>'
    );
    const block = findCopyableBlock(host.querySelector("#tok"));
    expect(block?.kind).toBe("code");
    expect(block?.el.tagName).toBe("PRE");
  });

  it("finds the enclosing table from a cell", () => {
    const host = html("<table><tbody><tr><td id='c'>a</td></tr></tbody></table>");
    const block = findCopyableBlock(host.querySelector("#c"));
    expect(block?.kind).toBe("table");
    expect(block?.el.tagName).toBe("TABLE");
  });

  it("ignores prose and returns null", () => {
    const host = html("<p id='p'>ただの段落</p>");
    expect(findCopyableBlock(host.querySelector("#p"))).toBeNull();
    expect(findCopyableBlock(null)).toBeNull();
  });

  it("ignores a mermaid block's own source pre", () => {
    // The mermaid node view renders its source in a <pre>, but it already has
    // a chart/source toggle and its text isn't a markdown fence body.
    const host = html(
      '<div data-type="mermaid-block"><pre><code id="m">graph TD;</code></pre></div>'
    );
    expect(findCopyableBlock(host.querySelector("#m"))).toBeNull();
  });
});

describe("codeTextOf", () => {
  it("returns the code text without the highlight markup", () => {
    const host = html(
      '<pre><code><span class="hljs-keyword">func</span> main() {\n\t<span class="hljs-title">println</span>()\n}</code></pre>'
    );
    const pre = host.querySelector("pre") as HTMLElement;
    expect(codeTextOf(pre)).toBe("func main() {\n\tprintln()\n}");
  });

  it("falls back to the pre's own text when there is no inner code element", () => {
    const host = html("<pre>bare</pre>");
    expect(codeTextOf(host.querySelector("pre") as HTMLElement)).toBe("bare");
  });
});
