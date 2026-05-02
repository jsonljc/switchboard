"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";

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
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys?.channels.list() ?? ["__disabled_channels_list__"],
    queryFn: fetchManagedChannels,
    enabled: !!keys,
  });
}

export function useProvision() {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
  return useMutation({
    mutationFn: async (body: {
      channels: Array<{
        channel: string;
        botToken?: string;
        webhookSecret?: string;
        signingSecret?: string;
        // WhatsApp-specific fields
        token?: string;
        phoneNumberId?: string;
        appSecret?: string;
        verifyToken?: string;
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
      if (keys) {
        queryClient.invalidateQueries({ queryKey: keys.orgConfig.all() });
        queryClient.invalidateQueries({ queryKey: keys.channels.all() });
      }
    },
  });
}

export function useDeleteChannel() {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
  return useMutation({
    mutationFn: async (channelId: string) => {
      const res = await fetch(`/api/dashboard/organizations/channels/${channelId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete channel");
      }
      return res.json();
    },
    onSuccess: () => {
      if (keys) {
        queryClient.invalidateQueries({ queryKey: keys.channels.all() });
        queryClient.invalidateQueries({ queryKey: keys.orgConfig.all() });
      }
    },
  });
}
