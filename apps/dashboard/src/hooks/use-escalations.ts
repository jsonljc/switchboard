"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";

export function useEscalations(status = "pending") {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys ? [...keys.escalations.all(), status] : ["__disabled_escalations__", status],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/escalations?status=${status}`);
      if (!res.ok) throw new Error("Failed to fetch escalations");
      return res.json();
    },
    enabled: !!keys,
  });
}

export function useEscalationDetail(id: string | null) {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys
      ? [...keys.escalations.all(), "detail", id]
      : ["__disabled_escalations_detail__", id],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/escalations/${id}`);
      if (!res.ok) throw new Error("Failed to fetch escalation");
      return res.json();
    },
    enabled: !!id && !!keys,
  });
}

export function useEscalationCount() {
  const { data } = useEscalations("pending");
  const escalations = (data as { escalations?: unknown[] })?.escalations;
  return Array.isArray(escalations) ? escalations.length : 0;
}

export function useResolveEscalation() {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
  return useMutation({
    mutationFn: async ({ id, resolutionNote }: { id: string; resolutionNote?: string }) => {
      const res = await fetch(`/api/dashboard/escalations/${id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(resolutionNote ? { resolutionNote } : {}) }),
      });
      if (!res.ok) throw new Error("Failed to resolve escalation");
      return res.json();
    },
    onSuccess: () => {
      if (keys) queryClient.invalidateQueries({ queryKey: keys.escalations.all() });
    },
  });
}
