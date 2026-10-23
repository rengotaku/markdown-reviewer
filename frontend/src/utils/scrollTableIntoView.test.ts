import { describe, expect, it } from "vitest";
import { scrollTableIntoView } from "./scrollTableIntoView";

/** Builds `.ProseMirror table > tbody > tr > td` (the shape #152 wraps in
 *  `overflow-x: auto`) and stubs `getBoundingClientRect` on both the table
 *  and the cell so the math is deterministic — no real layout engine. */
function buildTable(opts: {
  containerRect: Partial<DOMRect>;
  targetRect: Partial<DOMRect>;
  containerScrollLeft?: number;
}) {
  const proseMirror = document.createElement("div");
  proseMirror.className = "ProseMirror";
  const table = document.createElement("table");
  const tbody = document.createElement("tbody");
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  tr.appendChild(td);
  tbody.appendChild(tr);
  table.appendChild(tbody);
  proseMirror.appendChild(table);
  document.body.appendChild(proseMirror);

  table.scrollLeft = opts.containerScrollLeft ?? 0;
  table.getBoundingClientRect = () =>
    ({ left: 0, right: 612, top: 0, bottom: 100, width: 612, height: 100, x: 0, y: 0, toJSON: () => ({}) , ...opts.containerRect } as DOMRect);
  td.getBoundingClientRect = () =>
    ({ left: 0, right: 100, top: 0, bottom: 20, width: 100, height: 20, x: 0, y: 0, toJSON: () => ({}), ...opts.targetRect } as DOMRect);

  return { table, td };
}

describe("scrollTableIntoView", () => {
  it("scrolls right when the target's right edge is past the container's right edge (#310 repro: c-001 left 1356 vs container right 1096)", () => {
    const { table, td } = buildTable({
      containerRect: { left: 376, right: 1096 },
      targetRect: { left: 1356, right: 1456 },
      containerScrollLeft: 0,
    });
    scrollTableIntoView(td);
    // right overflow = 1456 - 1096 = 360
    expect(table.scrollLeft).toBe(360);
  });

  it("scrolls left when the target's left edge is before the container's left edge", () => {
    const { table, td } = buildTable({
      containerRect: { left: 376, right: 1096 },
      targetRect: { left: 100, right: 200 },
      containerScrollLeft: 500,
    });
    scrollTableIntoView(td);
    // left overflow = 376 - 100 = 276, subtracted from the existing scroll
    expect(table.scrollLeft).toBe(500 - 276);
  });

  it("leaves scrollLeft untouched when the target is already fully inside the container's width", () => {
    const { table, td } = buildTable({
      containerRect: { left: 376, right: 1096 },
      targetRect: { left: 400, right: 500 },
      containerScrollLeft: 120,
    });
    scrollTableIntoView(td);
    expect(table.scrollLeft).toBe(120);
  });

  it("is a no-op for a target outside any .ProseMirror table (ordinary paragraph highlight, #298 path unaffected)", () => {
    const proseMirror = document.createElement("div");
    proseMirror.className = "ProseMirror";
    const p = document.createElement("p");
    proseMirror.appendChild(p);
    document.body.appendChild(proseMirror);
    p.getBoundingClientRect = () =>
      ({ left: 1356, right: 1456, top: 0, bottom: 20, width: 100, height: 20, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);

    expect(() => scrollTableIntoView(p)).not.toThrow();
    // Nothing to assert on scrollLeft — there's no scroll container at all;
    // the function must simply return without touching the DOM.
  });

  it("targets the nearest ancestor table when a highlight spans a cell inside a nested/multiple table structure", () => {
    const { table, td } = buildTable({
      containerRect: { left: 0, right: 600 },
      targetRect: { left: 700, right: 800 },
    });
    const span = document.createElement("span");
    span.setAttribute("data-comment-id", "c-001");
    td.appendChild(span);
    span.getBoundingClientRect = () => td.getBoundingClientRect();

    scrollTableIntoView(span);
    expect(table.scrollLeft).toBe(200);
  });
});
