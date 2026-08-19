// internalLink resolves a Markdown link's `href` against the currently open
// file's path to decide whether it points at another Markdown file inside
// the same review root (#213). Such links become in-app navigation instead
// of a browser navigation / new tab.

// Matches a URL scheme prefix (`http:`, `mailto:`, `vscode:`, ...). Anything
// with a scheme is left to the browser's normal link handling.
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Resolves `href` (as written in the Markdown source) against
 * `currentFilePath` (the root-relative path of the file currently open in
 * the editor) into a root-relative path, or `null` when the link is not an
 * internal same-root document link.
 *
 * Returns `null` for:
 *   - scheme-qualified URLs (`https://...`, `mailto:...`, ...)
 *   - protocol-relative URLs (`//host/...`)
 *   - pure in-page anchors (`#heading`)
 *   - empty hrefs
 *   - paths that resolve outside the root (`../../etc/passwd`)
 *
 * `?query` and `#fragment` suffixes are dropped before resolving — this
 * util only cares about which file the link targets, not viewer-specific
 * deep-link state.
 */
export function resolveInternalLink(
  href: string,
  currentFilePath: string
): string | null {
  if (!href) return null;
  if (href.startsWith("#")) return null;
  if (href.startsWith("//")) return null;
  if (SCHEME_RE.test(href)) return null;

  // Drop a trailing query and/or fragment. Order matters: a `?` can appear
  // before a `#`, but not after, so cut at whichever comes first.
  let path = href;
  const queryIdx = path.indexOf("?");
  if (queryIdx !== -1) path = path.slice(0, queryIdx);
  const fragIdx = path.indexOf("#");
  if (fragIdx !== -1) path = path.slice(0, fragIdx);
  if (!path) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // Malformed percent-escapes: fall back to the raw (still-encoded) path
    // rather than failing the whole resolution.
    decoded = path;
  }

  const isRootAbsolute = decoded.startsWith("/");
  const baseSegments = isRootAbsolute
    ? []
    : dirSegments(currentFilePath);
  const relSegments = decoded.split("/").filter((s) => s.length > 0);

  const segments = [...baseSegments];
  for (const seg of relSegments) {
    if (seg === ".") continue;
    if (seg === "..") {
      if (segments.length === 0) {
        // Already at the root — one more ".." would escape it.
        return null;
      }
      segments.pop();
      continue;
    }
    segments.push(seg);
  }

  if (segments.length === 0) return null;
  return segments.join("/");
}

/** Directory segments of a root-relative file path (drops the filename). */
function dirSegments(filePath: string): string[] {
  const parts = filePath.split("/").filter((s) => s.length > 0);
  parts.pop();
  return parts;
}
