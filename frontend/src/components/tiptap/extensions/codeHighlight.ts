import { createLowlight } from "lowlight";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

/**
 * Languages registered for code-block highlighting (#198).
 *
 * highlight.js ships ~190 grammars; registering all of them would add roughly
 * a megabyte to the entry chunk for languages that never appear in these
 * documents. This list is deliberately the set that shows up in the markdown
 * this tool reviews — infra (bash / yaml / hcl-ish ini / dockerfile / sql),
 * app code (go / ruby / python / ts / js), and data or diff pastes. Anything
 * unregistered still renders as a plain code block, just without colours.
 *
 * `ini` doubles as the TOML/.env-style grammar; `xml` covers HTML.
 */
const LANGUAGES = {
  bash,
  css,
  diff,
  dockerfile,
  go,
  ini,
  javascript,
  json,
  markdown,
  python,
  ruby,
  sql,
  typescript,
  xml,
  yaml,
} as const;

/**
 * Extra fence names that should map onto one of the registered grammars, so a
 * ```` ```sh ```` or ```` ```tf ```` block is coloured instead of silently
 * falling back to plain text.
 */
const ALIASES: Record<string, keyof typeof LANGUAGES> = {
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  rb: "ruby",
  yml: "yaml",
  html: "xml",
  toml: "ini",
  hcl: "ini",
  tf: "ini",
  terraform: "ini",
  dotenv: "ini",
  md: "markdown",
  patch: "diff",
  psql: "sql",
  mysql: "sql",
  docker: "dockerfile",
};

export function createCodeLowlight() {
  const lowlight = createLowlight();
  for (const [name, grammar] of Object.entries(LANGUAGES)) {
    lowlight.register(name, grammar);
  }
  for (const [alias, target] of Object.entries(ALIASES)) {
    lowlight.register(alias, LANGUAGES[target]);
  }
  return lowlight;
}

export const HIGHLIGHTED_LANGUAGES = Object.keys(LANGUAGES);
export const LANGUAGE_ALIASES = ALIASES;
