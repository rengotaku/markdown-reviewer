/**
 * #332: the rail's icon mode shows one small "N 件" icon per line instead of
 * a card per comment. This groups the anchored comments (document order) into
 * what the rail places: a card for the selected comment, an icon for each run
 * of other comments anchored at the same height.
 *
 * Only *consecutive* comments merge, so an icon never spans a comment that
 * sits between its members in reading order. Comments with no measured anchor
 * stay single (the layout drops them until a measurement lands, same as a
 * card).
 */
export type IconRailEntry =
  | { kind: "card"; key: string; ids: [string] }
  | { kind: "icon"; key: string; ids: string[] };

/** Anchors closer than this (px) count as the same line. */
const SAME_LINE_PX = 1;

export function groupIconRailEntries(
  ids: readonly string[],
  anchorTops: Readonly<Record<string, number>>,
  selectedId: string | null
): IconRailEntry[] {
  const entries: IconRailEntry[] = [];
  let run: { top: number; ids: string[] } | null = null;

  const flush = () => {
    if (run) entries.push({ kind: "icon", key: `icon:${run.ids[0]}`, ids: run.ids });
    run = null;
  };

  for (const id of ids) {
    if (id === selectedId) {
      flush();
      entries.push({ kind: "card", key: id, ids: [id] });
      continue;
    }
    const top = Object.hasOwn(anchorTops, id) ? anchorTops[id] : null;
    if (top !== null && run && Math.abs(run.top - top) < SAME_LINE_PX) {
      run.ids.push(id);
      continue;
    }
    flush();
    if (top === null) {
      entries.push({ kind: "icon", key: `icon:${id}`, ids: [id] });
    } else {
      run = { top, ids: [id] };
    }
  }
  flush();
  return entries;
}
