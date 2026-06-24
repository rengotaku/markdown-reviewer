import yaml from "js-yaml";

/**
 * Matches the markdown-reviewer AI hint comment that the backend force-injects
 * at the very top of every saved file (see internal/handler/hint.go). Mirrors
 * the server's `hintBlockRe` so the client can peel the hint off before
 * locating the frontmatter that follows it.
 */
const HINT_RE = /^<!--\s*markdown-reviewer\b[\s\S]*?-->[ \t]*\r?\n*/;

/**
 * Matches a leading YAML frontmatter block: `---` on its own line, the YAML
 * body, then a closing `---` line. Anchored to the start of the
 * (hint-stripped) content so a `---` thematic break later in the document is
 * never mistaken for frontmatter.
 */
const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export interface PreambleSplit {
  /**
   * The non-editable leading material (AI hint + frontmatter), verbatim. It is
   * re-prepended to the editor's markdown output on every change so saving
   * never drops or reorders it.
   */
  preamble: string;
  /** Inner YAML of the frontmatter block (without the `---` fences); "" if none. */
  frontmatterYaml: string;
  /** The editable markdown body (everything after the preamble). */
  body: string;
}

/**
 * Split raw file content into a non-editable preamble (AI hint + YAML
 * frontmatter) and the editable markdown body.
 *
 * The frontmatter is deliberately kept out of the Tiptap editor: it has no
 * schema for YAML and mangles the `---` fences on roundtrip. Instead it is
 * surfaced separately as a read-only table above the editor, while the raw
 * `preamble` string is preserved untouched for saving.
 */
export function splitPreamble(raw: string): PreambleSplit {
  let rest = raw;
  let preamble = "";

  const hint = rest.match(HINT_RE);
  if (hint) {
    preamble += hint[0];
    rest = rest.slice(hint[0].length);
  }

  let frontmatterYaml = "";
  const fm = rest.match(FRONTMATTER_RE);
  if (fm) {
    preamble += fm[0];
    frontmatterYaml = fm[1];
    rest = rest.slice(fm[0].length);
  }

  return { preamble, frontmatterYaml, body: rest };
}

export type FrontmatterValue =
  | string
  | number
  | boolean
  | null
  | FrontmatterValue[]
  | { [key: string]: FrontmatterValue };

export interface FrontmatterEntry {
  key: string;
  value: FrontmatterValue;
}

/**
 * Parse the inner YAML of a frontmatter block into ordered key/value entries
 * for display.
 *
 * Parsing is best-effort and used only for rendering — the raw frontmatter
 * string is what gets persisted, so a parse miss degrades the table, never the
 * file. Uses JSON_SCHEMA so values stay JSON-shaped (e.g. `2026-06-24` remains
 * a string rather than becoming a Date). Returns [] when there is nothing to
 * show or the YAML isn't a top-level mapping.
 */
export function parseFrontmatter(frontmatterYaml: string): FrontmatterEntry[] {
  if (!frontmatterYaml.trim()) return [];
  let doc: unknown;
  try {
    doc = yaml.load(frontmatterYaml, { schema: yaml.JSON_SCHEMA });
  } catch {
    return [];
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return [];
  return Object.entries(doc as Record<string, FrontmatterValue>).map(([key, value]) => ({
    key,
    value,
  }));
}
