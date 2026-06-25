"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import type { GovernanceGateUnit, GovernanceMode } from "@switchboard/schemas";
import type {
  GovernanceObserveReviewResponse,
  GovernanceEnforceReadinessResponse,
} from "@/lib/api-client/governance";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json() as Promise<T>;
}

/** Per-gate "what enforce would have done" over the observe window (default 7d). */
export function useGovernanceObserveReview(agentId = "alex") {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys ? keys.governance.observeReview(agentId) : ["__disabled_observe_review__"],
    queryFn: () =>
      fetchJson<GovernanceObserveReviewResponse>(
        `/api/dashboard/agents/${agentId}/governance/observe-review`,
      ),
    enabled: !!keys,
  });
}

/** Per-gate current mode + whether each gate may be safely flipped to enforce. */
export function useGovernanceEnforceReadiness(agentId = "alex") {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys ? keys.governance.enforceReadiness(agentId) : ["__disabled_enforce_readiness__"],
    queryFn: () =>
      fetchJson<GovernanceEnforceReadinessResponse>(
        `/api/dashboard/agents/${agentId}/governance/enforce-readiness`,
      ),
    enabled: !!keys,
  });
}

/** Flip a gate observe <-> enforce (or off). The server refuses an unready enforce. */
export function useSetGovernanceGateMode(agentId = "alex") {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
  return useMutation({
    mutationFn: async ({ unit, mode }: { unit: GovernanceGateUnit; mode: GovernanceMode }) => {
      const res = await fetch(`/api/dashboard/agents/${agentId}/governance/gates/${unit}/mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Failed to set gate mode: ${res.status}`);
      }
      return res.json() as Promise<{ unit: string; mode: string }>;
    },
    // Refresh both surfaces after any flip attempt: success changes currentMode + the
    // observe counts going forward; a stale-UI REFUSE race must re-pull the live readiness
    // so the operator sees the current blockingReason instead of a disabled-but-stale control.
    onSettled: () => {
      if (!keys) return;
      queryClient.invalidateQueries({ queryKey: keys.governance.enforceReadiness(agentId) });
      queryClient.invalidateQueries({ queryKey: keys.governance.observeReview(agentId) });
    },
  });
}
