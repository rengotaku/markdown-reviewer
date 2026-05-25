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

/**
 * Comment scopes:
 *   - "inline"        — wraps a text range (default; emitted without scope attr)
 *   - "block"         — paragraph-level wrap (also wraps text)
 *   - "cross-section" — applies to multiple sections, not anchored to text
 *   - "global"        — applies to the whole file, not anchored to text
 */
export const COMMENT_SCOPES = [
  "inline",
  "block",
  "cross-section",
  "global",
] as const;
export type CommentScope = (typeof COMMENT_SCOPES)[number];
export const DEFAULT_COMMENT_SCOPE: CommentScope = "inline";

/** Scopes that wrap text (open + close markers around a range). */
export const ANCHORED_SCOPES: readonly CommentScope[] = ["inline", "block"];
/** Scopes that stand alone (open marker only, no wrapping). */
export const STANDALONE_SCOPES: readonly CommentScope[] = [
  "cross-section",
  "global",
];

export function isStandaloneScope(scope: string): boolean {
  return (STANDALONE_SCOPES as readonly string[]).includes(scope);
}

export function normalizeScope(raw: string | null | undefined): CommentScope {
  if (!raw) return DEFAULT_COMMENT_SCOPE;
  return (COMMENT_SCOPES as readonly string[]).includes(raw)
    ? (raw as CommentScope)
    : DEFAULT_COMMENT_SCOPE;
}

/**
 * Build the attribute string for an anchored comment marker:
 * `id="..." author="..." date="..." target="..." body="..." [scope="..."]`.
 * The scope attribute is emitted only when non-default so existing files
 * without a scope attribute round-trip byte-for-byte.
 */
export function buildCommentAttrs(attrs: {
  id: string;
  author: string;
  date: string;
  target: string;
  body: string;
  scope?: string;
}): string {
  const parts = [
    `id="${escapeCommentAttr(attrs.id)}"`,
    `author="${escapeCommentAttr(attrs.author)}"`,
    `date="${escapeCommentAttr(attrs.date)}"`,
    `target="${escapeCommentAttr(attrs.target)}"`,
    `body="${escapeCommentAttr(attrs.body)}"`,
  ];
  const scope = attrs.scope ?? "";
  if (scope && scope !== DEFAULT_COMMENT_SCOPE) {
    parts.push(`scope="${escapeCommentAttr(scope)}"`);
  }
  return parts.join(" ");
}

/**
 * Build the attribute string for a standalone (cross-section / global) comment
 * marker. Omits `target` because the comment is not anchored to any text.
 */
export function buildStandaloneCommentAttrs(attrs: {
  id: string;
  author: string;
  date: string;
  body: string;
  scope: string;
}): string {
  return [
    `id="${escapeCommentAttr(attrs.id)}"`,
    `author="${escapeCommentAttr(attrs.author)}"`,
    `date="${escapeCommentAttr(attrs.date)}"`,
    `body="${escapeCommentAttr(attrs.body)}"`,
    `scope="${escapeCommentAttr(attrs.scope)}"`,
  ].join(" ");
}

/** Regex that matches `@comment id="..." ...` inside a comment node's `.data`. */
export const COMMENT_OPEN_RE = /^\s*@comment\s+(.+?)\s*$/s;
/** Regex that matches `/@comment`. */
export const COMMENT_CLOSE_RE = /^\s*\/@comment\s*$/;
