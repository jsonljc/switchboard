"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface DlqMessage {
  id: string;
  channel: string;
  stage: string;
  errorMessage: string;
  retryCount: number;
  maxRetries: number;
  status: "pending" | "exhausted" | "resolved";
  payload: unknown;
  createdAt: string;
  resolvedAt: string | null;
}

export interface DlqStats {
  pending: number;
  exhausted: number;
  resolved: number;
  total: number;
}

const dlqKeys = {
  all: ["dlq"] as const,
  list: (status?: string) => ["dlq", "list", status] as const,
  stats: () => ["dlq", "stats"] as const,
};

async function fetchDlqMessages(status?: string): Promise<DlqMessage[]> {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  params.set("limit", "100");
  const res = await fetch(`/api/dashboard/dlq?${params}`);
  if (!res.ok) throw new Error("Failed to fetch DLQ messages");
  const data = await res.json();
  return data.messages;
}

async function fetchDlqStats(): Promise<DlqStats> {
  const res = await fetch("/api/dashboard/dlq/stats");
  if (!res.ok) throw new Error("Failed to fetch DLQ stats");
  const data = await res.json();
  return data.stats;
}

export function useDlqMessages(status?: string) {
  return useQuery({
    queryKey: dlqKeys.list(status),
    queryFn: () => fetchDlqMessages(status),
    refetchInterval: 15_000,
  });
}

export function useDlqStats() {
  return useQuery({
    queryKey: dlqKeys.stats(),
    queryFn: fetchDlqStats,
    refetchInterval: 15_000,
  });
}

export function useRetryDlqMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/dashboard/dlq/${id}/retry`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to retry message");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dlqKeys.all });
    },
  });
}

export function useResolveDlqMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/dashboard/dlq/${id}/resolve`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to resolve message");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dlqKeys.all });
    },
  });
}
