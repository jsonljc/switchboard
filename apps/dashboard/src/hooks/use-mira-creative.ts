"use client";

import { useQuery } from "@tanstack/react-query";
import type { MiraCreativeJobSummary } from "@switchboard/core";
import { useScopedQueryKeys } from "./use-query-keys";

/** Single Mira creative (seam-derived) for the detail page. */
export function useMiraCreative(id: string, initialData?: MiraCreativeJobSummary) {
  const keys = useScopedQueryKeys();
  const query = useQuery({
    queryKey: keys?.miraFeed.detail(id) ?? ["__disabled_mira_creative__"],
    initialData,
    queryFn: async (): Promise<MiraCreativeJobSummary> => {
      const res = await fetch(`/api/dashboard/agents/mira/creatives/${id}`);
      if (!res.ok) throw new Error(`Mira creative fetch failed (HTTP ${res.status})`);
      return ((await res.json()) as { job: MiraCreativeJobSummary }).job;
    },
    enabled: !!id && !!keys,
  });
  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: (query.error as Error | null) ?? null,
  };
}
