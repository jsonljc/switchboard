"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import type { ScheduledReportEntry, CreateScheduledReportInput } from "@/lib/api-client";

async function fetchReports(): Promise<ScheduledReportEntry[]> {
  const res = await fetch("/api/dashboard/scheduled-reports");
  if (!res.ok) throw new Error("Failed to fetch scheduled reports");
  const data = await res.json();
  return data.reports;
}

export function useScheduledReports() {
  return useQuery({
    queryKey: queryKeys.scheduledReports.list(),
    queryFn: fetchReports,
    refetchInterval: 30_000,
  });
}

export function useCreateReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateScheduledReportInput) => {
      const res = await fetch("/api/dashboard/scheduled-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create report");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.scheduledReports.all });
    },
  });
}

export function useUpdateReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...data
    }: { id: string } & Partial<CreateScheduledReportInput> & { enabled?: boolean }) => {
      const res = await fetch(`/api/dashboard/scheduled-reports/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update report");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.scheduledReports.all });
    },
  });
}

export function useDeleteReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/dashboard/scheduled-reports/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete report");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.scheduledReports.all });
    },
  });
}

export function useRunReport() {
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/dashboard/scheduled-reports/${id}/run`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to run report");
      return res.json();
    },
  });
}
