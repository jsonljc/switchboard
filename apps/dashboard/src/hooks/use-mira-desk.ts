"use client";

import { useQuery } from "@tanstack/react-query";
import type { MiraDeskModel } from "@switchboard/core";
import { useScopedQueryKeys } from "./use-query-keys";

/** Live Mira Director's Desk read-model. */
export function useMiraDesk() {
  const keys = useScopedQueryKeys();
  const query = useQuery({
    queryKey: keys?.miraFeed.desk() ?? ["__disabled_mira_desk__"],
    queryFn: async (): Promise<MiraDeskModel> => {
      const res = await fetch("/api/dashboard/agents/mira/desk");
      if (!res.ok) throw new Error(`Mira desk fetch failed (HTTP ${res.status})`);
      return ((await res.json()) as { desk: MiraDeskModel }).desk;
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
