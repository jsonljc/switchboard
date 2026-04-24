"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

export function useEscalations(status = "pending") {
  return useQuery({
    queryKey: [...queryKeys.escalations.all, status],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/escalations?status=${status}`);
      if (!res.ok) throw new Error("Failed to fetch escalations");
      return res.json();
    },
  });
}

export function useEscalationDetail(id: string | null) {
  return useQuery({
    queryKey: [...queryKeys.escalations.all, "detail", id],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/escalations/${id}`);
      if (!res.ok) throw new Error("Failed to fetch escalation");
      return res.json();
    },
    enabled: !!id,
  });
}

export function useEscalationCount() {
  const { data } = useEscalations("pending");
  const escalations = (data as { escalations?: unknown[] })?.escalations;
  return Array.isArray(escalations) ? escalations.length : 0;
}

export function useReplyToEscalation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, message }: { id: string; message: string }) => {
      const res = await fetch(`/api/dashboard/escalations/${id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (!res.ok) throw new Error("Failed to reply");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.escalations.all });
    },
  });
}

export function useResolveEscalation() {
  const queryClient = useQueryClient();
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
      queryClient.invalidateQueries({ queryKey: queryKeys.escalations.all });
    },
  });
}
