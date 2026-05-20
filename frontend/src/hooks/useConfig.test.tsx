import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode } from "react";
import { useConfig, configQueryKey } from "./useConfig";

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("useConfig", () => {
  it("exposes a stable query key", () => {
    expect(configQueryKey).toEqual(["config"]);
  });

  it("fetches and returns the review root config", async () => {
    const wrapper = makeWrapper();
    const { result } = renderHook(() => useConfig(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({ review_root_name: "mock-root" });
  });
});
