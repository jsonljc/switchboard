"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

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
  return useQuery({
    queryKey: queryKeys.connections.list(),
    queryFn: fetchConnections,
  });
}

export function useCreateConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { serviceId: string; serviceName: string; authType: string; credentials: Record<string, unknown>; scopes?: string[] }) => {
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
      queryClient.invalidateQueries({ queryKey: queryKeys.connections.all });
    },
  });
}

export function useDeleteConnection() {
  const queryClient = useQueryClient();
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
      queryClient.invalidateQueries({ queryKey: queryKeys.connections.all });
    },
  });
}

export function useTestConnection() {
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/dashboard/connections/${id}/test`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to test connection");
      }
      return res.json() as Promise<{ healthy: boolean; detail?: string }>;
    },
  });
}
