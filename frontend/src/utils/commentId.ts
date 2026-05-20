/**
 * UUID v7 generator (time-ordered, RFC 9562 layout).
 * Falls back to a sortable random string when `crypto.getRandomValues` is unavailable.
 */
export function generateCommentId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    return uuidV7();
  }
  return fallbackId();
}

function uuidV7(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  // 48-bit timestamp (ms since epoch)
  const now = Date.now();
  bytes[0] = (now / 2 ** 40) & 0xff;
  bytes[1] = (now / 2 ** 32) & 0xff;
  bytes[2] = (now >>> 24) & 0xff;
  bytes[3] = (now >>> 16) & 0xff;
  bytes[4] = (now >>> 8) & 0xff;
  bytes[5] = now & 0xff;

  // Version (7) in the high nibble of byte 6
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  // Variant (10) in the high two bits of byte 8
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex: string[] = [];
  for (let i = 0; i < 16; i++) hex.push(bytes[i].toString(16).padStart(2, "0"));
  return (
    hex.slice(0, 4).join("") +
    "-" +
    hex.slice(4, 6).join("") +
    "-" +
    hex.slice(6, 8).join("") +
    "-" +
    hex.slice(8, 10).join("") +
    "-" +
    hex.slice(10, 16).join("")
  );
}

function fallbackId(): string {
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
