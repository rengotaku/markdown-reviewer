import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode } from "react";
import { useDir, dirQueryKey } from "./useDir";

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("useDir", () => {
  it("exposes a stable query key per path", () => {
    expect(dirQueryKey("")).toEqual(["dir", ""]);
    expect(dirQueryKey("docs")).toEqual(["dir", "docs"]);
    expect(dirQueryKey("docs/api")).toEqual(["dir", "docs/api"]);
  });

  it("fetches the root directory listing when path is empty", async () => {
    const wrapper = makeWrapper();
    const { result } = renderHook(() => useDir(""), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.entries).toEqual([
      { name: "docs", path: "docs", type: "dir" },
      { name: "README.md", path: "README.md", type: "file" },
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
      { name: "spec.md", path: "docs/api/spec.md", type: "file" },
    ]);
  });
});
