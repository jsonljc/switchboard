"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import type { IdentitySpec } from "@switchboard/schemas";

async function fetchIdentity(): Promise<{ spec: IdentitySpec }> {
  const res = await fetch("/api/dashboard/identity");
  if (!res.ok) throw new Error("Failed to fetch identity");
  return res.json();
}

export function useIdentity() {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys?.identity.all() ?? ["__disabled_identity__"],
    queryFn: fetchIdentity,
    enabled: !!keys,
  });
}

export function useUpdateIdentity() {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();

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
      if (keys) queryClient.invalidateQueries({ queryKey: keys.identity.all() });
    },
  });
}
