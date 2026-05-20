/**
 * Generate the next versioned filename in the same directory.
 *
 * Examples:
 *   nextVersionedPath("foo.md", ["foo.md"])                 → "foo.v2.md"
 *   nextVersionedPath("foo.md", ["foo.md", "foo.v2.md"])    → "foo.v3.md"
 *   nextVersionedPath("foo.v2.md", ["foo.md", "foo.v2.md"]) → "foo.v3.md"
 *   nextVersionedPath("a/b/c.md", ["a/b/c.md", "a/b/c.v5.md"]) → "a/b/c.v6.md"
 *
 * Only .md files are supported. For non-.md files we fall back to appending
 * `.v2.md` (which shouldn't happen since the app is .md-only, but defensive).
 */
export function nextVersionedPath(
  currentPath: string,
  existingPaths: readonly string[]
): string {
  const slash = currentPath.lastIndexOf("/");
  const dir = slash === -1 ? "" : currentPath.slice(0, slash + 1);
  const filename = slash === -1 ? currentPath : currentPath.slice(slash + 1);

  const md = /^(.+?)(?:\.v(\d+))?\.md$/i.exec(filename);
  if (!md) {
    return `${currentPath}.v2.md`;
  }
  const base = md[1];
  const currentN = md[2] ? parseInt(md[2], 10) : 1;

  const sibRe = new RegExp(
    `^${escapeRegex(base)}(?:\\.v(\\d+))?\\.md$`,
    "i"
  );

  let maxN = currentN;
  for (const p of existingPaths) {
    if (!p.startsWith(dir)) continue;
    const sibFn = p.slice(dir.length);
    if (sibFn.includes("/")) continue; // not in the same dir
    const m = sibRe.exec(sibFn);
    if (!m) continue;
    const n = m[1] ? parseInt(m[1], 10) : 1;
    if (n > maxN) maxN = n;
  }

  return `${dir}${base}.v${maxN + 1}.md`;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
