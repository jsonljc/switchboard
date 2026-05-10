"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AuditEntriesListResponseSchema,
  type AuditEntriesListQuery,
  type AuditEntriesListResponse,
} from "@switchboard/schemas";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import { ACTIVITY_FIXTURES } from "../fixtures";

// Read process.env per call so vitest can mutate NEXT_PUBLIC_ACTIVITY_LIVE
// between fixture-branch and live-branch tests. In production Next.js inlines
// the value at build time, so this is effectively a constant.
const isLive = (): boolean => process.env.NEXT_PUBLIC_ACTIVITY_LIVE === "true";

function buildSearch(query: Partial<AuditEntriesListQuery>): string {
  const params = new URLSearchParams();
  if (query.scope) params.set("scope", query.scope);
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.eventType) params.set("eventType", query.eventType);
  if (query.actorType) params.set("actorType", query.actorType);
  if (query.entityType) params.set("entityType", query.entityType);
  if (query.entityId) params.set("entityId", query.entityId);
  if (query.after) params.set("after", query.after);
  if (query.before) params.set("before", query.before);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

const FIXTURE_RESPONSE: AuditEntriesListResponse = {
  rows: ACTIVITY_FIXTURES,
  nextCursor: null,
  scope: "operational",
  appliedFilters: {
    eventType: null,
    actorType: null,
    entityType: null,
    entityId: null,
    after: null,
    before: null,
  },
};

export function useActivityList(query: Partial<AuditEntriesListQuery>) {
  const keys = useScopedQueryKeys();
  const live = isLive();

  return useQuery<AuditEntriesListResponse>({
    queryKey: keys?.activity.list(query) ?? (["__disabled_activity__", query] as const),
    queryFn: async () => {
      if (!live) return FIXTURE_RESPONSE;
      const res = await fetch(`/api/dashboard/activity${buildSearch(query)}`);
      if (!res.ok) throw new Error(`Failed to load activity: ${res.status}`);
      // Validate at the boundary so upstream contract drift surfaces as a
      // React Query error rather than a rendering crash deeper in the tree.
      return AuditEntriesListResponseSchema.parse(await res.json());
    },
    enabled: !live || !!keys,
    staleTime: live ? 30_000 : Infinity,
    // NO refetchInterval — paginated lists with polling break cursor stability.
  });
}
