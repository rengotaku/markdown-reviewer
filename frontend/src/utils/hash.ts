/** foo.md → foo_fix.md, foo → foo_fix */
export function buildFixFilename(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return `${name}_fix`;
  return `${name.slice(0, dot)}_fix${name.slice(dot)}`;
}
