/**
 * HTML comment attribute escaping for `<!-- @comment ... -->` markers.
 *
 * Values are stored as JSON-string-like escapes so they survive HTML comments
 * (which forbid `--` and have other quirks). Newlines collapse to `\n`.
 */
const ESCAPES: Array<[RegExp, string]> = [
  [/\\/g, "\\\\"],
  [/"/g, '\\"'],
  [/\r\n|\n|\r/g, "\\n"],
  [/--/g, "\\-\\-"],
];

const UNESCAPES: Array<[RegExp, string]> = [
  [/\\-\\-/g, "--"],
  [/\\n/g, "\n"],
  [/\\"/g, '"'],
  [/\\\\/g, "\\"],
];

export function escapeCommentAttr(value: string): string {
  let out = value;
  for (const [pattern, replacement] of ESCAPES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

export function unescapeCommentAttr(value: string): string {
  let out = value;
  for (const [pattern, replacement] of UNESCAPES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * Parse `id="..." author="..." date="..." target="..."` into a record.
 * Handles escaped quotes (\") and escaped backslashes (\\).
 */
export function parseCommentAttrs(input: string): Record<string, string> {
  const result: Record<string, string> = {};
  const re = /(\w+)\s*=\s*"((?:\\.|[^"\\])*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    result[m[1]] = unescapeCommentAttr(m[2]);
  }
  return result;
}

/** Build the attribute string portion `id="..." author="..." date="..." target="..."`. */
export function buildCommentAttrs(attrs: {
  id: string;
  author: string;
  date: string;
  target: string;
}): string {
  return [
    `id="${escapeCommentAttr(attrs.id)}"`,
    `author="${escapeCommentAttr(attrs.author)}"`,
    `date="${escapeCommentAttr(attrs.date)}"`,
    `target="${escapeCommentAttr(attrs.target)}"`,
  ].join(" ");
}

/** Regex that matches `@comment id="..." ...` inside a comment node's `.data`. */
export const COMMENT_OPEN_RE = /^\s*@comment\s+(.+?)\s*$/s;
/** Regex that matches `/@comment`. */
export const COMMENT_CLOSE_RE = /^\s*\/@comment\s*$/;
