import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode } from "react";
import { useFiles } from "./useFiles";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useFiles", () => {
  it("returns the mocked file list", async () => {
    const { result } = renderHook(() => useFiles(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.files.map((f) => f.path)).toEqual([
      "README.md",
      "docs/intro.md",
      "docs/api/spec.md",
    ]);
  });
});
