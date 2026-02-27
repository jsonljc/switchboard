"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import type { IdentitySpec } from "@switchboard/schemas";

async function fetchIdentity(): Promise<{ spec: IdentitySpec }> {
  const res = await fetch("/api/dashboard/identity");
  if (!res.ok) throw new Error("Failed to fetch identity");
  return res.json();
}

export function useIdentity() {
  return useQuery({
    queryKey: queryKeys.identity.all,
    queryFn: fetchIdentity,
  });
}

export function useUpdateIdentity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { id: string } & Partial<IdentitySpec>) => {
      const res = await fetch("/api/dashboard/identity", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update identity");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.identity.all });
    },
  });
}
