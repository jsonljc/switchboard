"use client";

import { useInfiniteQuery, type UseInfiniteQueryResult } from "@tanstack/react-query";
import {
  ScheduledTriggersListResponseSchema,
  type ScheduledTriggersListQuery,
  type ScheduledTriggersListResponse,
} from "@switchboard/schemas";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import { isMercuryToolLive } from "@/lib/route-availability";
import { AUTOMATIONS_FIXTURE_PAGE } from "../fixtures";

export type AutomationsListQueryInput = Partial<Omit<ScheduledTriggersListQuery, "cursor">>;

export type UseAutomationsListResult = UseInfiniteQueryResult<
  { pages: ScheduledTriggersListResponse[]; pageParams: (string | undefined)[] },
  Error
>;

const isLive = (): boolean => isMercuryToolLive("automations");

function buildSearch(query: AutomationsListQueryInput, cursor: string | undefined): string {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.sort) params.set("sort", query.sort);
  if (query.direction) params.set("direction", query.direction);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (cursor) params.set("cursor", cursor);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function useAutomationsList(query: AutomationsListQueryInput): UseAutomationsListResult {
  const keys = useScopedQueryKeys();
  const live = isLive();

  return useInfiniteQuery<
    ScheduledTriggersListResponse,
    Error,
    { pages: ScheduledTriggersListResponse[]; pageParams: (string | undefined)[] },
    readonly unknown[],
    string | undefined
  >({
    queryKey: keys?.automations.list(query) ?? (["__disabled_automations__", query] as const),
    queryFn: async ({ pageParam }) => {
      if (!live) return AUTOMATIONS_FIXTURE_PAGE;
      const res = await fetch(`/api/dashboard/automations${buildSearch(query, pageParam)}`);
      if (!res.ok) throw new Error(`Failed to load automations: ${res.status}`);
      return ScheduledTriggersListResponseSchema.parse(await res.json());
    },
    initialPageParam: undefined,
    getNextPageParam: (last) => (live ? (last.nextCursor ?? undefined) : undefined),
    enabled: !live || !!keys,
    staleTime: live ? 30_000 : Infinity,
  });
}
