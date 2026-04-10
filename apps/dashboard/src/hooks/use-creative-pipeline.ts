"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreativeJobSummary } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";

export function useCreativeJobs(deploymentId: string) {
  return useQuery({
    queryKey: queryKeys.creativeJobs.list(deploymentId),
    queryFn: async () => {
      const res = await fetch(
        `/api/dashboard/marketplace/creative-jobs?deploymentId=${encodeURIComponent(deploymentId)}`,
      );
      if (!res.ok) throw new Error("Failed to fetch creative jobs");
      const data = await res.json();
      return data.jobs as CreativeJobSummary[];
    },
    enabled: !!deploymentId,
    refetchInterval: (query) => {
      const jobs = query.state.data;
      if (!jobs) return false;
      const hasActive = jobs.some((j) => j.currentStage !== "complete" && !j.stoppedAt);
      return hasActive ? 30_000 : false;
    },
  });
}

export function useCreativeJob(id: string) {
  return useQuery({
    queryKey: queryKeys.creativeJobs.detail(id),
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/marketplace/creative-jobs/${id}`);
      if (!res.ok) throw new Error("Failed to fetch creative job");
      const data = await res.json();
      return data.job as CreativeJobSummary;
    },
    enabled: !!id,
    refetchInterval: (query) => {
      const job = query.state.data;
      if (!job) return false;
      return job.currentStage !== "complete" && !job.stoppedAt ? 30_000 : false;
    },
  });
}

export function useApproveStage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ jobId, action }: { jobId: string; action: "continue" | "stop" }) => {
      const res = await fetch(`/api/dashboard/marketplace/creative-jobs/${jobId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error("Failed to update pipeline");
      const data = await res.json();
      return data as { job: CreativeJobSummary; action: string };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.creativeJobs.all });
    },
  });
}
