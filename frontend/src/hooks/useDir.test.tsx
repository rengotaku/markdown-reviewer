import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { type ReactNode } from "react";
import { useDir, dirQueryKey } from "./useDir";

const ROOT = "mock-root";

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["config"], {
    review_root_name: ROOT,
    review_root: `/tmp/${ROOT}`,
    review_roots: [{ name: ROOT, path: `/tmp/${ROOT}` }],
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  };
}

describe("useDir", () => {
  it("exposes a stable query key per (root, path) pair", () => {
    expect(dirQueryKey(ROOT, "")).toEqual(["dir", ROOT, ""]);
    expect(dirQueryKey(ROOT, "docs")).toEqual(["dir", ROOT, "docs"]);
    expect(dirQueryKey(ROOT, "docs/api")).toEqual(["dir", ROOT, "docs/api"]);
  });

  it("fetches the root directory listing when path is empty", async () => {
    const wrapper = makeWrapper();
    const { result } = renderHook(() => useDir(""), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.entries).toEqual([
      { name: "docs", path: "docs", type: "dir", modified: "2026-05-20T00:00:00Z" },
      { name: "README.md", path: "README.md", type: "file", modified: "2026-05-20T00:00:00Z" },
    ]);
  });

  it("fetches a nested directory listing", async () => {
    const wrapper = makeWrapper();
    const { result } = renderHook(() => useDir("docs"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.entries.map((e) => e.path)).toEqual([
      "docs/api",
      "docs/intro.md",
    ]);
  });

  it("does not fetch when disabled via opts.enabled = false", async () => {
    const wrapper = makeWrapper();
    const { result } = renderHook(() => useDir("docs", { enabled: false }), {
      wrapper,
    });

    // Query stays in idle/pending state — never resolves to success.
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.data).toBeUndefined();
  });

  it("fetches by default when opts is omitted (enabled defaults to true)", async () => {
    const wrapper = makeWrapper();
    const { result } = renderHook(() => useDir("docs/api"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.entries).toEqual([
      { name: "spec.md", path: "docs/api/spec.md", type: "file", modified: "2026-05-20T00:00:00Z" },
    ]);
  });
});
