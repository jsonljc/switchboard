"use client";
import { useQuery } from "@tanstack/react-query";
import { HomeSummarySchema, type HomeSummary } from "@switchboard/schemas";
import { useScopedQueryKeys } from "./use-query-keys";

export interface HomeSummaryQuery {
  data?: HomeSummary;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

export function useHomeSummary(): HomeSummaryQuery {
  const keys = useScopedQueryKeys();
  const query = useQuery({
    queryKey: keys?.homeSummary.feed() ?? ["__disabled_home_summary__"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/home/summary");
      if (!res.ok) throw new Error(`Home summary fetch failed (HTTP ${res.status})`);
      return HomeSummarySchema.parse(await res.json());
    },
    enabled: !!keys,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: (query.error as Error | null) ?? null,
  };
}
