"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { PipelineBoardResponseSchema, type PipelineBoardResponse } from "@switchboard/schemas";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import { isMercuryToolLive } from "@/lib/route-availability";
import { PIPELINE_FIXTURE_PAGE } from "../fixtures";

const isLive = (): boolean => isMercuryToolLive("contacts");

export function useOpportunitiesBoard(): UseQueryResult<PipelineBoardResponse, Error> {
  const keys = useScopedQueryKeys();
  const live = isLive();

  return useQuery<PipelineBoardResponse, Error>({
    queryKey: keys?.opportunities.board() ?? (["__disabled_opportunities_board__"] as const),
    queryFn: async () => {
      if (!live) return PIPELINE_FIXTURE_PAGE;
      const res = await fetch("/api/dashboard/opportunities");
      if (!res.ok) throw new Error(`Failed to load opportunities: ${res.status}`);
      return PipelineBoardResponseSchema.parse(await res.json());
    },
    enabled: !live || !!keys,
    staleTime: live ? 30_000 : Infinity,
  });
}
