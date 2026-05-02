"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";

interface Connection {
  id: string;
  serviceId: string;
  serviceName: string;
  authType: string;
  status: string;
  createdAt: string;
}

async function fetchConnections(): Promise<{ connections: Connection[] }> {
  const res = await fetch("/api/dashboard/connections");
  if (!res.ok) throw new Error("Failed to fetch connections");
  return res.json();
}

export function useConnections() {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys?.connections.list() ?? ["__disabled_connections_list__"],
    queryFn: fetchConnections,
    enabled: !!keys,
  });
}

export function useCreateConnection() {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
  return useMutation({
    mutationFn: async (body: {
      serviceId: string;
      serviceName: string;
      authType: string;
      credentials: Record<string, unknown>;
      scopes?: string[];
    }) => {
      const res = await fetch("/api/dashboard/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create connection");
      }
      return res.json();
    },
    onSuccess: () => {
      if (keys) queryClient.invalidateQueries({ queryKey: keys.connections.all() });
    },
  });
}

export function useDeleteConnection() {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/dashboard/connections/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete connection");
      }
      return res.json();
    },
    onSuccess: () => {
      if (keys) queryClient.invalidateQueries({ queryKey: keys.connections.all() });
    },
  });
}

export function useTestConnection() {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/dashboard/connections/${id}/test`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to test connection");
      }
      return res.json() as Promise<{ healthy: boolean; detail?: string }>;
    },
    onSuccess: () => {
      if (keys) queryClient.invalidateQueries({ queryKey: keys.connections.all() });
    },
  });
}

export function useUpdateConnection() {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
  return useMutation({
    mutationFn: async ({
      id,
      ...body
    }: {
      id: string;
      serviceName?: string;
      authType?: string;
      credentials?: Record<string, unknown>;
      scopes?: string[];
    }) => {
      const res = await fetch(`/api/dashboard/connections/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to update connection");
      }
      return res.json();
    },
    onSuccess: () => {
      if (keys) queryClient.invalidateQueries({ queryKey: keys.connections.all() });
    },
  });
}
