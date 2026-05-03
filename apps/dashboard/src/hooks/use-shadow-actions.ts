"use client";

import { useQuery } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import type { RecommendationApiRow } from "@/lib/api-client-types";

async function fetchShadowActions(): Promise<{ recommendations: RecommendationApiRow[] }> {
  const res = await fetch(
    "/api/dashboard/recommendations?surface=shadow_action&status=pending&since=24h",
  );
  if (!res.ok) throw new Error("Failed to fetch shadow actions");
  return res.json();
}

export function useShadowActions() {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys?.recommendations.shadow() ?? ["__disabled_recommendations_shadow__"],
    queryFn: fetchShadowActions,
    refetchInterval: 60_000,
    enabled: !!keys,
  });
}
