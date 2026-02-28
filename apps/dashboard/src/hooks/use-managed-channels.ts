"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

interface ManagedChannel {
  id: string;
  channel: string;
  botUsername: string | null;
  webhookPath: string;
  webhookRegistered: boolean;
  status: string;
  statusDetail: string | null;
  lastHealthCheck: string | null;
  createdAt: string;
}

async function fetchManagedChannels(): Promise<{ channels: ManagedChannel[] }> {
  const res = await fetch("/api/dashboard/organizations/channels");
  if (!res.ok) throw new Error("Failed to fetch channels");
  return res.json();
}

export function useManagedChannels() {
  return useQuery({
    queryKey: queryKeys.channels.list(),
    queryFn: fetchManagedChannels,
  });
}

export function useProvision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      channels: Array<{
        channel: string;
        botToken: string;
        webhookSecret?: string;
        signingSecret?: string;
      }>;
    }) => {
      const res = await fetch("/api/dashboard/organizations/provision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Provisioning failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.orgConfig.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.channels.all });
    },
  });
}
