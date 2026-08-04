import { describe, it, expect } from "vitest";
import { visibleTableWidth } from "./tableGeometry";

function stubRect(el: Element, width: number) {
  el.getBoundingClientRect = () =>
    ({ width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0 }) as DOMRect;
}

function buildTable(blockWidth: number, rowWidth: number | null): HTMLTableElement {
  const table = document.createElement("table");
  stubRect(table, blockWidth);
  if (rowWidth !== null) {
    const row = document.createElement("tr");
    stubRect(row, rowWidth);
    table.appendChild(row);
  }
  return table;
}

describe("visibleTableWidth", () => {
  it("uses the row width when the table is narrower than the editor column", () => {
    // Real measurement from #171: block box 624 (column width) vs row 160.
    expect(visibleTableWidth(buildTable(624, 160))).toBe(160);
  });

  it("clamps to the block width when the table overflows and scrolls", () => {
    // Real measurement from #171's wide table: row 906.8 inside a 624 column.
    expect(visibleTableWidth(buildTable(624, 906.8))).toBe(624);
  });

  it("returns the same width when the row exactly fills the column", () => {
    expect(visibleTableWidth(buildTable(624, 624))).toBe(624);
  });

  it("falls back to the block width when there is no row", () => {
    expect(visibleTableWidth(buildTable(624, null))).toBe(624);
  });

  it("falls back to the block width when the row measures zero (unrendered)", () => {
    expect(visibleTableWidth(buildTable(624, 0))).toBe(624);
  });
});
