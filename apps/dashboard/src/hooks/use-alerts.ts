"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import type { AlertRule, CreateAlertInput, AlertHistoryEntry } from "@/lib/api-client";

async function fetchAlerts(): Promise<AlertRule[]> {
  const res = await fetch("/api/dashboard/alerts");
  if (!res.ok) throw new Error("Failed to fetch alerts");
  const data = await res.json();
  return data.rules;
}

async function fetchAlertHistory(id: string): Promise<AlertHistoryEntry[]> {
  const res = await fetch(`/api/dashboard/alerts/${id}/history`);
  if (!res.ok) throw new Error("Failed to fetch alert history");
  const data = await res.json();
  return data.history;
}

export function useAlerts() {
  return useQuery({
    queryKey: queryKeys.alerts.list(),
    queryFn: fetchAlerts,
    refetchInterval: 30_000,
  });
}

export function useAlertHistory(id: string | null) {
  return useQuery({
    queryKey: queryKeys.alerts.history(id ?? ""),
    queryFn: () => fetchAlertHistory(id!),
    enabled: !!id,
  });
}

export function useCreateAlert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateAlertInput) => {
      const res = await fetch("/api/dashboard/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create alert");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.alerts.all });
    },
  });
}

export function useUpdateAlert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...data
    }: { id: string } & Partial<CreateAlertInput> & { enabled?: boolean }) => {
      const res = await fetch(`/api/dashboard/alerts/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update alert");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.alerts.all });
    },
  });
}

export function useDeleteAlert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/dashboard/alerts/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete alert");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.alerts.all });
    },
  });
}
