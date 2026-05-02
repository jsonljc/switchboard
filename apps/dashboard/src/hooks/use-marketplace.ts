"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  MarketplaceListing,
  MarketplaceDeployment,
  MarketplaceTask,
  TrustScoreBreakdown,
  DraftFAQ,
} from "@/lib/api-client";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";

// ── Listings ──

export function useListings(filters?: { status?: string; type?: string }) {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys?.marketplace.listings(filters) ?? ["__disabled_marketplace_listings__"],
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
    enabled: !!keys,
  });
}

export function useListing(id: string) {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys?.marketplace.listing(id) ?? ["__disabled_marketplace_listing__"],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/marketplace/listings/${id}`);
      if (!res.ok) throw new Error("Failed to fetch listing");
      const data = await res.json();
      return data.listing as MarketplaceListing;
    },
    enabled: !!id && !!keys,
  });
}

export function useTrustScore(id: string) {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys?.marketplace.trust(id) ?? ["__disabled_marketplace_trust__"],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/marketplace/listings/${id}/trust`);
      if (!res.ok) throw new Error("Failed to fetch trust score");
      return (await res.json()) as TrustScoreBreakdown;
    },
    enabled: !!id && !!keys,
  });
}

export function useTrustProgression(listingId: string) {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys?.marketplace.trustProgression(listingId) ?? [
      "__disabled_marketplace_trust_progression__",
    ],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/marketplace/listings/${listingId}/trust/progression`);
      if (!res.ok) throw new Error("Failed to fetch trust progression");
      const data = await res.json();
      return data.progression as Array<{ timestamp: string; score: number }>;
    },
    enabled: !!listingId && !!keys,
  });
}

// ── Deployments ──

export function useDeployments() {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys?.marketplace.deployments() ?? ["__disabled_marketplace_deployments__"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/marketplace/deployments");
      if (!res.ok) throw new Error("Failed to fetch deployments");
      const data = await res.json();
      return data.deployments as MarketplaceDeployment[];
    },
    enabled: !!keys,
  });
}

export function useDeployment(id: string | null) {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys
      ? [...keys.marketplace.all(), "deployment", id]
      : ["__disabled_marketplace_deployment__", id],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/marketplace/deployments");
      if (!res.ok) throw new Error("Failed to fetch deployments");
      const { deployments } = await res.json();
      const deployment = deployments.find((d: { id: string }) => d.id === id);
      if (!deployment) throw new Error("Deployment not found");
      return deployment as MarketplaceDeployment;
    },
    enabled: !!id && !!keys,
  });
}

export function useDeployListing() {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
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
      if (keys) {
        void queryClient.invalidateQueries({ queryKey: keys.marketplace.deployments() });
      }
    },
  });
}

// ── Tasks ──

export function useTasks(filters?: { status?: string; deploymentId?: string }) {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys?.tasks.list(filters) ?? ["__disabled_tasks_list__"],
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
    enabled: !!keys,
  });
}

export function useReviewTask() {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
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
      if (keys) void queryClient.invalidateQueries({ queryKey: keys.tasks.all() });
    },
  });
}

export function useSubmitTaskOutput() {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
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
      if (keys) void queryClient.invalidateQueries({ queryKey: keys.tasks.all() });
    },
  });
}

// ── FAQ Drafts ──

export function useDraftFAQs(deploymentId: string, orgId: string) {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys?.marketplace.faqDrafts(deploymentId) ?? ["__disabled_marketplace_faq_drafts__"],
    queryFn: async () => {
      const res = await fetch(
        `/api/dashboard/marketplace/deployments/${deploymentId}/faq-drafts?orgId=${orgId}`,
      );
      if (!res.ok) throw new Error("Failed to fetch FAQ drafts");
      const data = await res.json();
      return data.data as DraftFAQ[];
    },
    enabled: !!deploymentId && !!keys,
  });
}

export function useApproveFAQ(deploymentId: string, orgId: string) {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
  return useMutation({
    mutationFn: async (faqId: string) => {
      const res = await fetch(
        `/api/dashboard/marketplace/deployments/${deploymentId}/faq-drafts/${faqId}/approve?orgId=${orgId}`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error("Failed to approve FAQ");
    },
    onSuccess: () => {
      if (keys) {
        void queryClient.invalidateQueries({
          queryKey: keys.marketplace.faqDrafts(deploymentId),
        });
      }
    },
  });
}

export function useRejectFAQ(deploymentId: string, orgId: string) {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
  return useMutation({
    mutationFn: async (faqId: string) => {
      const res = await fetch(
        `/api/dashboard/marketplace/deployments/${deploymentId}/faq-drafts/${faqId}/reject?orgId=${orgId}`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error("Failed to reject FAQ");
    },
    onSuccess: () => {
      if (keys) {
        void queryClient.invalidateQueries({
          queryKey: keys.marketplace.faqDrafts(deploymentId),
        });
      }
    },
  });
}
