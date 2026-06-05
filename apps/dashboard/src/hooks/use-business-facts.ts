"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import type { BusinessFacts } from "@switchboard/schemas";

export type BusinessFactsStatus = "present" | "missing" | "malformed";

export interface BusinessFactsResponse {
  facts: BusinessFacts | null;
  status: BusinessFactsStatus;
}

/** Thrown when the proxy rejects the payload (HTTP 400); carries the zod flatten() details. */
export class BusinessFactsValidationError extends Error {
  details: unknown;
  constructor(details: unknown) {
    super("Business facts validation failed");
    this.name = "BusinessFactsValidationError";
    this.details = details;
  }
}

async function fetchBusinessFacts(deploymentId: string): Promise<BusinessFactsResponse> {
  const res = await fetch(`/api/dashboard/marketplace/deployments/${deploymentId}/business-facts`);
  if (!res.ok) throw new Error("Failed to fetch business facts");
  return res.json();
}

export function useBusinessFacts(deploymentId: string | null) {
  const keys = useScopedQueryKeys();
  const enabled = !!keys && !!deploymentId;
  return useQuery({
    queryKey:
      keys && deploymentId
        ? keys.marketplace.businessFacts(deploymentId)
        : ["__disabled_business_facts__"],
    queryFn: () => fetchBusinessFacts(deploymentId as string),
    enabled,
  });
}

export function useUpsertBusinessFacts(deploymentId: string | null) {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
  return useMutation({
    mutationFn: async (facts: BusinessFacts) => {
      const res = await fetch(
        `/api/dashboard/marketplace/deployments/${deploymentId}/business-facts`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(facts),
        },
      );
      if (res.status === 400) {
        const body = await res.json().catch(() => ({}));
        throw new BusinessFactsValidationError((body as { details?: unknown })?.details ?? body);
      }
      if (!res.ok) throw new Error("Failed to save business facts");
      return res.json();
    },
    onSuccess: () => {
      if (keys && deploymentId) {
        queryClient.invalidateQueries({ queryKey: keys.marketplace.businessFacts(deploymentId) });
        queryClient.invalidateQueries({ queryKey: keys.readiness.all() });
      }
    },
  });
}
