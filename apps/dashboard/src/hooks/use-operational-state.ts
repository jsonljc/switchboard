"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import type { OperationalState } from "@switchboard/schemas";

/**
 * Wire shape of a persisted confirmation after it crossed the JSON boundary
 * (Date columns serialize to ISO strings). Named -Wire so the cross-app-types
 * advisory does not flag a collision with the schemas-level
 * OperationalStateConfirmation (whose timestamps are Dates).
 */
export interface OperationalStateConfirmationWire {
  id: string;
  organizationId: string;
  state: OperationalState;
  confirmedBy: string | null;
  confirmedAt: string;
  createdAt: string;
}

export interface OperationalStateResponse {
  confirmation: OperationalStateConfirmationWire | null;
}

/** Thrown when the proxy rejects the payload (HTTP 400); carries the zod flatten() details. */
export class OperationalStateValidationError extends Error {
  details: unknown;
  constructor(details: unknown) {
    super("Operational state validation failed");
    this.name = "OperationalStateValidationError";
    this.details = details;
  }
}

async function fetchLatestOperationalState(
  deploymentId: string,
): Promise<OperationalStateResponse> {
  const res = await fetch(
    `/api/dashboard/marketplace/deployments/${deploymentId}/operational-state`,
  );
  if (!res.ok) throw new Error("Failed to fetch operational state");
  return res.json();
}

export function useOperationalState(deploymentId: string | null) {
  const keys = useScopedQueryKeys();
  const enabled = !!keys && !!deploymentId;
  return useQuery({
    queryKey:
      keys && deploymentId
        ? keys.marketplace.operationalState(deploymentId)
        : ["__disabled_operational_state__"],
    queryFn: () => fetchLatestOperationalState(deploymentId as string),
    enabled,
  });
}

export function useRecordOperationalState(deploymentId: string | null) {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
  return useMutation({
    mutationFn: async (
      state: OperationalState,
    ): Promise<{ confirmation: OperationalStateConfirmationWire }> => {
      if (!deploymentId) {
        throw new Error("Cannot record operational state without a deploymentId");
      }
      const res = await fetch(
        `/api/dashboard/marketplace/deployments/${deploymentId}/operational-state`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(state),
        },
      );
      if (res.status === 400) {
        const body = await res.json().catch(() => ({}));
        throw new OperationalStateValidationError((body as { details?: unknown })?.details ?? body);
      }
      if (!res.ok) throw new Error("Failed to record operational state");
      return res.json();
    },
    onSuccess: () => {
      if (keys && deploymentId) {
        queryClient.invalidateQueries({
          queryKey: keys.marketplace.operationalState(deploymentId),
        });
      }
    },
  });
}
