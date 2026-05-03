"use client";

import { useQuery } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import type { RecommendationApiRow } from "@/lib/api-client-types";

async function fetchQueueRecommendations(): Promise<{ recommendations: RecommendationApiRow[] }> {
  const res = await fetch("/api/dashboard/recommendations?surface=queue&status=pending");
  if (!res.ok) throw new Error("Failed to fetch recommendations");
  return res.json();
}

export function useRecommendations() {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys?.recommendations.queue() ?? ["__disabled_recommendations_queue__"],
    queryFn: fetchQueueRecommendations,
    refetchInterval: 60_000,
    enabled: !!keys,
  });
}

export function useRecommendationCount() {
  const { data } = useRecommendations();
  return data?.recommendations.length ?? 0;
}
