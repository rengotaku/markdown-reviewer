import { useQuery } from "@tanstack/react-query";
import { getConfig, type ConfigResponse } from "@/api";

export const configQueryKey = ["config"] as const;

export function useConfig() {
  return useQuery<ConfigResponse>({
    queryKey: configQueryKey,
    queryFn: getConfig,
    staleTime: Infinity,
  });
}
