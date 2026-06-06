"use client";

import { useQuery } from "@tanstack/react-query";
import type { MiraCreativeJobSummary, MiraCreativeCounts } from "@switchboard/core";
import { useScopedQueryKeys } from "./use-query-keys";

export interface MiraFeedData {
  jobs: MiraCreativeJobSummary[];
  counts: MiraCreativeCounts;
  feed: { reviewableCount: number; renderingCount: number };
}

/** Live Mira review feed. Server returns only reviewable (video-bearing) jobs. */
export function useMiraFeed(limit = 20) {
  const keys = useScopedQueryKeys();
  const query = useQuery({
    queryKey: keys?.miraFeed.list() ?? ["__disabled_mira_feed__"],
    queryFn: async (): Promise<MiraFeedData> => {
      const res = await fetch(`/api/dashboard/agents/mira/creatives?limit=${limit}`);
      if (!res.ok) throw new Error(`Mira feed fetch failed (HTTP ${res.status})`);
      return (await res.json()) as MiraFeedData;
    },
    enabled: !!keys,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: (query.error as Error | null) ?? null,
    refetch: query.refetch,
  };
}
