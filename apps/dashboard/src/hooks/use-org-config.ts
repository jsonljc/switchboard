"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

export interface OrgConfig {
  id: string;
  name: string;
  runtimeType: string;
  runtimeConfig: Record<string, unknown>;
  governanceProfile: string;
  onboardingComplete: boolean;
  managedChannels: string[];
  provisioningStatus: string;
}

async function fetchOrgConfig(): Promise<{ config: OrgConfig }> {
  const res = await fetch("/api/dashboard/organizations");
  if (!res.ok) throw new Error("Failed to fetch org config");
  return res.json();
}

export function useOrgConfig() {
  return useQuery({
    queryKey: queryKeys.orgConfig.current(),
    queryFn: fetchOrgConfig,
    retry: false,
  });
}

export function useUpdateOrgConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: Partial<OrgConfig>) => {
      const res = await fetch("/api/dashboard/organizations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to update org config");
      }
      return res.json() as Promise<{ config: OrgConfig }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.orgConfig.all });
    },
  });
}
