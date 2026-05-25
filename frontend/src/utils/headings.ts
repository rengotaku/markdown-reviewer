import type { Editor } from "@tiptap/react";

export interface DocHeading {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  /** Position of the heading node in the doc. */
  pos: number;
}

/**
 * Walk the editor doc and collect heading nodes whose level is in `levels`.
 * Duplicate text values are kept in document order; callers that need to bind
 * a comment to a specific heading must rely on the combination of text and
 * position (the side pane currently treats them as a list of names only).
 */
export function collectHeadings(
  editor: Editor | null,
  levels: ReadonlyArray<number> = [1, 2]
): DocHeading[] {
  if (!editor || editor.isDestroyed) return [];
  const out: DocHeading[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "heading") return;
    const level = node.attrs.level;
    if (typeof level !== "number" || !levels.includes(level)) return;
    out.push({
      level: level as DocHeading["level"],
      text: node.textContent.trim(),
      pos,
    });
  });
  return out;
}

/** Encode a list of section titles into the `target` attribute value. */
export function encodeSections(sections: ReadonlyArray<string>): string {
  return sections.map((s) => s.trim()).filter((s) => s.length > 0).join("\n");
}

/** Decode a `target` attribute value (saved by encodeSections) back to a list. */
export function decodeSections(target: string): string[] {
  if (!target) return [];
  return target
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
