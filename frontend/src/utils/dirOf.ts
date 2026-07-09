/**
 * Return the directory portion of a root-relative path.
 *
 * Examples:
 *   dirOf("a/b/c.md") → "a/b"
 *   dirOf("c.md")     → ""      (root level)
 *   dirOf("")         → ""
 *
 * Two paths are "in the same directory" iff their dirOf() values are equal,
 * so root-level files all share the "" directory.
 */
export function dirOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}
