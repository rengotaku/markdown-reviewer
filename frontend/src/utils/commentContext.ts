import type { CommentJSON } from "@/api";

/** The text/section a comment was originally anchored to, from its stored
 *  anchor(s). Used to show what an orphaned comment pointed at, even after the
 *  canonical body changed and the live position can no longer be resolved. */
function originalTarget(c: CommentJSON): string {
  const fmt = (heading: string[] | null, snippet: string) => {
    const head = (heading ?? []).at(-1);
    return head ? `${head} › ${snippet}` : snippet;
  };
  // A multi-line inline comment (#162) keeps its first block in `anchor` and
  // the rest in `anchors`, so both must be listed — taking `anchors` alone
  // would drop the block the selection started on from the orphan readout.
  const all = [...(c.anchor ? [c.anchor] : []), ...(c.anchors ?? [])];
  return all.map((a) => fmt(a.heading_path, a.snippet)).join(" / ");
}

export function contextLabel(c: CommentJSON): string | null {
  if (c.scope === "global") return null;
  if (c.orphan) {
    const orig = originalTarget(c);
    return orig ? `${orig}（現在の本文には見つかりません）` : "位置不明 (orphan)";
  }
  // cross_section is about *which sections* a comment spans, so it keeps the
  // heading list even though buildCommentJSON now resolves a context for it
  // too (#162 made every anchor contribute, `anchors`-only included).
  if (c.scope === "cross_section" && c.anchors && c.anchors.length > 0) {
    return c.anchors
      .map((a) => (a.heading_path ?? []).at(-1) ?? a.snippet)
      .filter(Boolean)
      .join(" ・ ");
  }
  // Otherwise `context` first: a multi-line inline comment (#162) carries
  // `anchors` too, and its line_range already spans every anchor — so the
  // heading + L74–80 form stays, instead of degrading to a list of repeated
  // heading names.
  if (c.context) {
    const head = (c.context.heading_path ?? []).at(-1);
    const [s, e] = c.context.line_range;
    const lines = s === e ? `L${s}` : `L${s}–${e}`;
    return head ? `${head} (${lines})` : lines;
  }
  if (c.anchors && c.anchors.length > 0) {
    return c.anchors
      .map((a) => (a.heading_path ?? []).at(-1) ?? a.snippet)
      .filter(Boolean)
      .join(" ・ ");
  }
  if (c.anchor) return c.anchor.snippet;
  return null;
}
