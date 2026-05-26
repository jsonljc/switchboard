"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";

/**
 * Mutation hook for marking an escalation resolved.
 *
 * Wraps POST /api/dashboard/escalations/:id/resolve which proxies to the
 * upstream `/api/escalations/:id/resolve`. The upstream returns 200
 * `{ escalation }` on success; `resolutionNote` is optional and persisted
 * (audit log only). Unlike reply there is no 502 branch — resolve does not
 * touch the channel adapter.
 *
 * Invalidates the escalations cache on success. Decision-feed invalidation
 * (so the resolved handoff drops out of the inbox) is the caller's
 * responsibility — see HandoffDetailItem in inbox-screen.tsx.
 */
export function useEscalationResolve(escalationId: string) {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();

  const mutation = useMutation({
    mutationFn: async (resolutionNote?: string): Promise<void> => {
      const res = await fetch(`/api/dashboard/escalations/${escalationId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolutionNote }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Resolve failed (HTTP ${res.status})`);
      }
    },
    onSuccess: () => {
      if (keys) queryClient.invalidateQueries({ queryKey: keys.escalations.all() });
    },
  });

  return {
    resolve: (resolutionNote?: string) => mutation.mutateAsync(resolutionNote),
    isPending: mutation.isPending,
  };
}
