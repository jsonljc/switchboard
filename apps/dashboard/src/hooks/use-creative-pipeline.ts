"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreativeJobSummary } from "@/lib/api-client";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";

export function useCreativeJobs(deploymentId: string) {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys?.creativeJobs.list(deploymentId) ?? ["__disabled_creative_jobs_list__"],
    queryFn: async () => {
      const res = await fetch(
        `/api/dashboard/marketplace/creative-jobs?deploymentId=${encodeURIComponent(deploymentId)}`,
      );
      if (!res.ok) throw new Error("Failed to fetch creative jobs");
      const data = await res.json();
      return data.jobs as CreativeJobSummary[];
    },
    enabled: !!deploymentId && !!keys,
    refetchInterval: (query) => {
      const jobs = query.state.data;
      if (!jobs) return false;
      const hasActive = jobs.some((j) => j.currentStage !== "complete" && !j.stoppedAt);
      return hasActive ? 30_000 : false;
    },
  });
}

export function useCreativeJob(id: string, initialData?: CreativeJobSummary) {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys?.creativeJobs.detail(id) ?? ["__disabled_creative_jobs_detail__"],
    initialData,
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/marketplace/creative-jobs/${id}`);
      if (!res.ok) throw new Error("Failed to fetch creative job");
      const data = await res.json();
      return data.job as CreativeJobSummary;
    },
    enabled: !!id && !!keys,
    refetchInterval: (query) => {
      const job = query.state.data;
      if (!job) return false;
      return job.currentStage !== "complete" && !job.stoppedAt ? 30_000 : false;
    },
  });
}

export function useApproveStage() {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
  return useMutation({
    mutationFn: async ({
      jobId,
      action,
      productionTier,
    }: {
      jobId: string;
      action: "continue" | "stop";
      productionTier?: "basic" | "pro";
    }) => {
      const res = await fetch(`/api/dashboard/marketplace/creative-jobs/${jobId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(productionTier ? { productionTier } : {}) }),
      });
      if (!res.ok) throw new Error("Failed to update pipeline");
      const data = await res.json();
      return data as { job: CreativeJobSummary; action: string };
    },
    onSuccess: () => {
      if (keys) void queryClient.invalidateQueries({ queryKey: keys.creativeJobs.all() });
    },
  });
}

export function useCostEstimate(jobId: string, enabled: boolean) {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys?.creativeJobs.estimate(jobId) ?? ["__disabled_creative_jobs_estimate__"],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/marketplace/creative-jobs/${jobId}/estimate`);
      if (!res.ok) throw new Error("Failed to fetch cost estimate");
      const data = await res.json();
      return data.estimates as {
        basic: { cost: number; description: string };
        pro: { cost: number; description: string };
      } | null;
    },
    enabled: enabled && !!jobId && !!keys,
  });
}

export function useSubmitBrief() {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
  return useMutation({
    mutationFn: async (body: {
      deploymentId: string;
      listingId: string;
      brief: {
        productDescription: string;
        targetAudience: string;
        platforms: string[];
        brandVoice?: string | null;
        productImages?: string[];
        references?: string[];
        generateReferenceImages?: boolean;
      };
    }) => {
      const res = await fetch("/api/dashboard/marketplace/creative-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to create creative job");
      return res.json();
    },
    onSuccess: () => {
      if (keys) void queryClient.invalidateQueries({ queryKey: keys.creativeJobs.all() });
    },
  });
}
