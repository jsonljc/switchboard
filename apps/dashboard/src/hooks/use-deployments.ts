"use client";

import { useQuery } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import type { MarketplaceDeployment } from "@/lib/api-client/marketplace-types";

async function fetchDeployments(): Promise<{ deployments: MarketplaceDeployment[] }> {
  const res = await fetch("/api/dashboard/marketplace/deployments");
  if (!res.ok) throw new Error("Failed to fetch deployments");
  return res.json();
}

export function useDeployments() {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys?.marketplace.deployments() ?? ["__disabled_deployments__"],
    queryFn: fetchDeployments,
    enabled: !!keys,
  });
}

/**
 * The org's deployment id used purely as the org-ownership ANCHOR for the
 * business-facts route. The route re-keys the write to the authenticated org,
 * so any of the org's deployment ids is correct; we take the first. Returns
 * null while loading or when the org has no deployments.
 */
export function useOrgDeploymentId(): {
  deploymentId: string | null;
  isLoading: boolean;
  isError: boolean;
} {
  const { data, isLoading, isError } = useDeployments();
  return { deploymentId: data?.deployments?.[0]?.id ?? null, isLoading, isError };
}
