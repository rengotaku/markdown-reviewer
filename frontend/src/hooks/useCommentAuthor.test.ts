import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const STORAGE_KEY = "markdown-reviewer-comment-author";

describe("useCommentAuthor", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe("without VITE_COMMENT_AUTHOR env override", () => {
    beforeEach(() => {
      vi.stubEnv("VITE_COMMENT_AUTHOR", "");
    });

    it('falls back to "reviewer" when localStorage is empty', async () => {
      const { useCommentAuthor } = await import("./useCommentAuthor");
      const { result } = renderHook(() => useCommentAuthor());
      expect(result.current.author).toBe("reviewer");
    });

    it("returns the value previously written to localStorage", async () => {
      localStorage.setItem(STORAGE_KEY, "alice");
      const { useCommentAuthor } = await import("./useCommentAuthor");
      const { result } = renderHook(() => useCommentAuthor());
      expect(result.current.author).toBe("alice");
    });

    it('falls back to "reviewer" when the stored value is only whitespace', async () => {
      localStorage.setItem(STORAGE_KEY, "   ");
      const { useCommentAuthor } = await import("./useCommentAuthor");
      const { result } = renderHook(() => useCommentAuthor());
      expect(result.current.author).toBe("reviewer");
    });

    it("setAuthor persists the value to localStorage and notifies subscribers", async () => {
      const { useCommentAuthor } = await import("./useCommentAuthor");
      const { result } = renderHook(() => useCommentAuthor());

      act(() => {
        result.current.setAuthor("bob");
      });

      expect(result.current.author).toBe("bob");
      expect(localStorage.getItem(STORAGE_KEY)).toBe("bob");
    });

    it("setAuthor trims whitespace before storing", async () => {
      const { useCommentAuthor } = await import("./useCommentAuthor");
      const { result } = renderHook(() => useCommentAuthor());

      act(() => {
        result.current.setAuthor("  carol  ");
      });

      expect(result.current.author).toBe("carol");
      expect(localStorage.getItem(STORAGE_KEY)).toBe("carol");
    });

    it("setAuthor ignores empty / whitespace-only values", async () => {
      localStorage.setItem(STORAGE_KEY, "dave");
      const { useCommentAuthor } = await import("./useCommentAuthor");
      const { result } = renderHook(() => useCommentAuthor());
      expect(result.current.author).toBe("dave");

      act(() => {
        result.current.setAuthor("   ");
      });

      // Stored value is untouched, author stays "dave".
      expect(result.current.author).toBe("dave");
      expect(localStorage.getItem(STORAGE_KEY)).toBe("dave");
    });

    it("persistCommentAuthor (named export) writes through to localStorage", async () => {
      const mod = await import("./useCommentAuthor");
      const { result } = renderHook(() => mod.useCommentAuthor());

      act(() => {
        mod.persistCommentAuthor("erin");
      });

      expect(result.current.author).toBe("erin");
      expect(localStorage.getItem(STORAGE_KEY)).toBe("erin");
    });

    it("swallows localStorage.getItem errors and falls back", async () => {
      const spy = vi.spyOn(globalThis.localStorage, "getItem").mockImplementation(() => {
        throw new Error("storage disabled");
      });

      const { useCommentAuthor } = await import("./useCommentAuthor");
      const { result } = renderHook(() => useCommentAuthor());

      expect(result.current.author).toBe("reviewer");
      spy.mockRestore();
    });

    it("swallows localStorage.setItem errors silently", async () => {
      const spy = vi.spyOn(globalThis.localStorage, "setItem").mockImplementation(() => {
        throw new Error("quota exceeded");
      });

      const { useCommentAuthor } = await import("./useCommentAuthor");
      const { result } = renderHook(() => useCommentAuthor());

      expect(() =>
        act(() => {
          result.current.setAuthor("frank");
        })
      ).not.toThrow();

      // Since setItem failed, the stored value didn't change, but the
      // listeners still fired — author re-reads and falls back to "reviewer".
      expect(result.current.author).toBe("reviewer");
      spy.mockRestore();
    });
  });

  describe("with VITE_COMMENT_AUTHOR env override", () => {
    beforeEach(() => {
      vi.stubEnv("VITE_COMMENT_AUTHOR", "env-user");
    });

    it("returns the env value regardless of localStorage", async () => {
      localStorage.setItem(STORAGE_KEY, "should-be-ignored");
      const { useCommentAuthor } = await import("./useCommentAuthor");
      const { result } = renderHook(() => useCommentAuthor());

      expect(result.current.author).toBe("env-user");
    });

    it("trims surrounding whitespace from the env override", async () => {
      vi.stubEnv("VITE_COMMENT_AUTHOR", "  spaced-env  ");
      const { useCommentAuthor } = await import("./useCommentAuthor");
      const { result } = renderHook(() => useCommentAuthor());

      expect(result.current.author).toBe("spaced-env");
    });
  });
});
