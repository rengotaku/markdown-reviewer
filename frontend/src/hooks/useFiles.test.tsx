import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { type ReactNode } from "react";
import { useFiles } from "./useFiles";

const ROOT = "mock-root";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["config"], {
    review_root_name: ROOT,
    review_root: `/tmp/${ROOT}`,
    review_roots: [{ name: ROOT, path: `/tmp/${ROOT}` }],
  });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
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
