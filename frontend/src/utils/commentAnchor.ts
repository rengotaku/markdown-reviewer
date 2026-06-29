// commentAnchor mirrors the backend's content-derived anchoring
// (internal/reviewstore/comments.go) on the client so the UI computes anchors
// and resolves them identically — line-based, heading-scoped, occurrence-
// indexed. Keeping this a pure string function makes it unit-testable without
// a live ProseMirror editor.

export interface AnchorLike {
  heading_path: string[];
  snippet: string;
  occurrence: number;
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;

/** headingStacks returns, per 0-indexed line, the heading stack in effect. */
export function headingStacks(body: string): string[][] {
  const lines = body.split("\n");
  const out: string[][] = [];
  const stack: { text: string; level: number }[] = [];
  for (const line of lines) {
    const m = line.trim().match(HEADING_RE);
    if (m) {
      const level = m[1].length;
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ text: `${m[1]} ${m[2].trim()}`, level });
    }
    out.push(stack.map((e) => e.text));
  }
  return out;
}

function suffixMatch(stack: string[], want: string[]): boolean {
  if (want.length > stack.length) return false;
  const off = stack.length - want.length;
  return want.every((w, i) => stack[off + i] === w);
}

/**
 * resolveAnchorLine finds the 0-indexed body line for an anchor (the
 * occurrence-th snippet match under a matching heading path), or null when the
 * anchor is orphaned. Mirrors backend ResolveAnchor (which returns 1-indexed).
 */
export function resolveAnchorLine(body: string, anchor: AnchorLike): number | null {
  if (!anchor.snippet) return null;
  const stacks = headingStacks(body);
  const lines = body.split("\n");
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(anchor.snippet)) continue;
    if (anchor.heading_path.length && !suffixMatch(stacks[i], anchor.heading_path)) continue;
    if (seen === anchor.occurrence) return i;
    seen++;
  }
  return null;
}

/**
 * computeAnchorAtLine builds the anchor for a snippet located on lineIndex:
 * the heading stack there, plus the occurrence index counted among identical
 * snippets under the same heading appearing on earlier lines. This is the
 * inverse of resolveAnchorLine and produces matching occurrence values.
 */
export function computeAnchorAtLine(
  body: string,
  snippet: string,
  lineIndex: number
): AnchorLike {
  const stacks = headingStacks(body);
  const lines = body.split("\n");
  const heading_path = stacks[lineIndex] ?? [];
  let occurrence = 0;
  for (let i = 0; i < lineIndex; i++) {
    if (!lines[i].includes(snippet)) continue;
    if (heading_path.length && !suffixMatch(stacks[i], heading_path)) continue;
    occurrence++;
  }
  return { heading_path, snippet, occurrence };
}
