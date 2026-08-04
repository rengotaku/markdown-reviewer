/**
 * Width of the table box the user actually sees, for positioning the overlay
 * "add row / add column" buttons.
 *
 * `.ProseMirror table` is `display: block` so a wide table can scroll
 * horizontally inside the editor column (#152). That turns the `<table>`
 * element into a plain block box, and a block box fills its containing block
 * exactly like a paragraph does — so `table.getBoundingClientRect().width` is
 * the *editor column* width, never the table's own. The real table width only
 * exists on the anonymous table box generated inside, and the rows are the
 * only thing that reports it (measured on a 2-column table: block 624px vs
 * row 160px, which put the "+" button 468px away from the table's right edge —
 * #171).
 *
 * What the buttons want is the visible box:
 *   - table narrower than the column -> the table's own width
 *   - table wider than the column    -> the scroll box's width, so the button
 *                                       stays at the visible right edge
 *                                       instead of running off-screen
 *
 * i.e. `min(row width, block width)`. For a table that is *not* a block box
 * the two are equal, so this is a no-op there.
 */
export function visibleTableWidth(tableEl: HTMLElement): number {
  const blockWidth = tableEl.getBoundingClientRect().width;
  const row = tableEl.querySelector("tr");
  if (!row) return blockWidth;
  // Every table-row box spans the table's content width, so the first row is
  // representative and we avoid measuring every row on each frame.
  const rowWidth = row.getBoundingClientRect().width;
  if (rowWidth <= 0) return blockWidth;
  return Math.min(rowWidth, blockWidth);
}
