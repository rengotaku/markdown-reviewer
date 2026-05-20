import { describe, it, expect } from "vitest";
import { generateCommentId } from "./commentId";

describe("generateCommentId", () => {
  it("returns a UUIDv7-shaped string when crypto is available", () => {
    const id = generateCommentId();
    // RFC 9562 layout: 8-4-4-4-12 hex; version nibble = 7, variant = 8/9/a/b
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("generates unique values across calls", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(generateCommentId());
    expect(seen.size).toBe(50);
  });

  it("falls back to a sortable string when crypto.getRandomValues is missing", () => {
    const originalCrypto = globalThis.crypto;
    try {
      Object.defineProperty(globalThis, "crypto", {
        value: { ...originalCrypto, getRandomValues: undefined },
        configurable: true,
      });
      const id = generateCommentId();
      expect(id).toMatch(/^c-[0-9a-z]+-[0-9a-z]{1,}$/);
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        value: originalCrypto,
        configurable: true,
      });
    }
  });
});
