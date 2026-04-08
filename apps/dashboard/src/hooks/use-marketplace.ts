"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  MarketplaceListing,
  MarketplaceDeployment,
  MarketplaceTask,
  TrustScoreBreakdown,
} from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";

// ── Listings ──

export function useListings(filters?: { status?: string; type?: string }) {
  return useQuery({
    queryKey: queryKeys.marketplace.listings(filters),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.status) params.set("status", filters.status);
      if (filters?.type) params.set("type", filters.type);
      const qs = params.toString();
      const res = await fetch(`/api/dashboard/marketplace/listings${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error("Failed to fetch listings");
      const data = await res.json();
      return data.listings as MarketplaceListing[];
    },
  });
}

export function useListing(id: string) {
  return useQuery({
    queryKey: queryKeys.marketplace.listing(id),
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/marketplace/listings/${id}`);
      if (!res.ok) throw new Error("Failed to fetch listing");
      const data = await res.json();
      return data.listing as MarketplaceListing;
    },
    enabled: !!id,
  });
}

export function useTrustScore(id: string) {
  return useQuery({
    queryKey: queryKeys.marketplace.trust(id),
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/marketplace/listings/${id}/trust`);
      if (!res.ok) throw new Error("Failed to fetch trust score");
      return (await res.json()) as TrustScoreBreakdown;
    },
    enabled: !!id,
  });
}

export function useTrustProgression(listingId: string) {
  return useQuery({
    queryKey: queryKeys.marketplace.trustProgression(listingId),
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/marketplace/listings/${listingId}/trust/progression`);
      if (!res.ok) throw new Error("Failed to fetch trust progression");
      const data = await res.json();
      return data.progression as Array<{ timestamp: string; score: number }>;
    },
    enabled: !!listingId,
  });
}

// ── Deployments ──

export function useDeployments() {
  return useQuery({
    queryKey: queryKeys.marketplace.deployments(),
    queryFn: async () => {
      const res = await fetch("/api/dashboard/marketplace/deployments");
      if (!res.ok) throw new Error("Failed to fetch deployments");
      const data = await res.json();
      return data.deployments as MarketplaceDeployment[];
    },
  });
}

export function useDeployListing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      listingId,
      config,
    }: {
      listingId: string;
      config: {
        inputConfig?: Record<string, unknown>;
        governanceSettings?: Record<string, unknown>;
        outputDestination?: Record<string, unknown>;
        connectionIds?: string[];
      };
    }) => {
      const res = await fetch(`/api/dashboard/marketplace/listings/${listingId}/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!res.ok) throw new Error("Failed to deploy listing");
      const data = await res.json();
      return data.deployment as MarketplaceDeployment;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.marketplace.deployments() });
    },
  });
}

// ── Tasks ──

export function useTasks(filters?: { status?: string; deploymentId?: string }) {
  return useQuery({
    queryKey: queryKeys.tasks.list(filters),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.status) params.set("status", filters.status);
      if (filters?.deploymentId) params.set("deploymentId", filters.deploymentId);
      const qs = params.toString();
      const res = await fetch(`/api/dashboard/marketplace/tasks${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error("Failed to fetch tasks");
      const data = await res.json();
      return data.tasks as MarketplaceTask[];
    },
    refetchInterval: 60_000, // Poll every 60 seconds
  });
}

export function useReviewTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      taskId,
      result,
      reviewResult,
    }: {
      taskId: string;
      result: "approved" | "rejected";
      reviewResult?: string;
    }) => {
      const res = await fetch(`/api/dashboard/marketplace/tasks/${taskId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result, reviewResult }),
      });
      if (!res.ok) throw new Error("Failed to review task");
      const data = await res.json();
      return data.task as MarketplaceTask;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
    },
  });
}

export function useSubmitTaskOutput() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ taskId, output }: { taskId: string; output: Record<string, unknown> }) => {
      const res = await fetch(`/api/dashboard/marketplace/tasks/${taskId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ output }),
      });
      if (!res.ok) throw new Error("Failed to submit task output");
      const data = await res.json();
      return data.task as MarketplaceTask;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
    },
  });
}
