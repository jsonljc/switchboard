"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";

export interface OrgConfig {
  id: string;
  name: string;
  runtimeType: string;
  runtimeConfig: Record<string, unknown>;
  governanceProfile: string;
  onboardingComplete: boolean;
  managedChannels: string[];
  provisioningStatus: string;
  currency?: string;
}

async function fetchOrgConfig(): Promise<{ config: OrgConfig }> {
  const res = await fetch("/api/dashboard/organizations");
  if (!res.ok) throw new Error("Failed to fetch org config");
  return res.json();
}

export function useOrgConfig(enabled = true) {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys?.orgConfig.current() ?? ["__disabled_org_config__"],
    queryFn: fetchOrgConfig,
    retry: false,
    enabled: enabled && !!keys,
  });
}

export function useUpdateOrgConfig() {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
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
      if (keys) queryClient.invalidateQueries({ queryKey: keys.orgConfig.all() });
    },
  });
}
