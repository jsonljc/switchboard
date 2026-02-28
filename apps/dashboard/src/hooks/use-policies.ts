"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import type { Policy } from "@switchboard/schemas";

async function fetchPolicies(): Promise<{ policies: Policy[] }> {
  const res = await fetch("/api/dashboard/policies");
  if (!res.ok) throw new Error("Failed to fetch policies");
  return res.json();
}

export function usePolicies() {
  return useQuery({
    queryKey: queryKeys.policies.list(),
    queryFn: fetchPolicies,
  });
}

export function useCreatePolicy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: Omit<Policy, "id" | "createdAt" | "updatedAt">) => {
      const res = await fetch("/api/dashboard/policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create policy");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.policies.all });
    },
  });
}

export function useUpdatePolicy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { id: string } & Partial<Policy>) => {
      const res = await fetch("/api/dashboard/policies", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update policy");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.policies.all });
    },
  });
}

export function useDeletePolicy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/dashboard/policies?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete policy");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.policies.all });
    },
  });
}
