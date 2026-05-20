/** djb2 hash — fast, synchronous, good enough for change-detection. */
export function simpleHash(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
    h = h >>> 0; // keep unsigned 32-bit
  }
  return h.toString(36);
}

/** foo.md → foo_fix.md, foo → foo_fix */
export function buildFixFilename(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return `${name}_fix`;
  return `${name.slice(0, dot)}_fix${name.slice(dot)}`;
}
