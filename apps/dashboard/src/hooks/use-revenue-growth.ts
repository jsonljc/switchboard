"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import type {
  RevGrowthDiagnosticResult,
  RevGrowthConnectorHealth,
  RevGrowthIntervention,
  RevGrowthDigest,
} from "@/lib/api-client";

// --- Diagnostic ---

async function fetchDiagnostic(accountId: string): Promise<RevGrowthDiagnosticResult | null> {
  const res = await fetch(
    `/api/dashboard/revenue-growth/diagnostic?accountId=${encodeURIComponent(accountId)}`,
  );
  if (!res.ok) throw new Error("Failed to fetch diagnostic");
  const data = (await res.json()) as { data: RevGrowthDiagnosticResult | null };
  return data.data ?? null;
}

export function useDiagnostic(accountId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.revenueGrowth.diagnostic(accountId ?? ""),
    queryFn: () => fetchDiagnostic(accountId!),
    enabled: !!accountId,
    refetchInterval: 120_000,
  });
}

export function useRunDiagnostic() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (accountId: string) => {
      const res = await fetch("/api/dashboard/revenue-growth/diagnostic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId }),
      });
      if (!res.ok) throw new Error("Failed to run diagnostic");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.revenueGrowth.all });
    },
  });
}

// --- Connectors ---

async function fetchConnectors(accountId: string): Promise<RevGrowthConnectorHealth[]> {
  const res = await fetch(
    `/api/dashboard/revenue-growth/connectors?accountId=${encodeURIComponent(accountId)}`,
  );
  if (!res.ok) throw new Error("Failed to fetch connectors");
  const data = (await res.json()) as { connectors: RevGrowthConnectorHealth[] };
  return data.connectors ?? [];
}

export function useConnectorStatus(accountId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.revenueGrowth.connectors(accountId ?? ""),
    queryFn: () => fetchConnectors(accountId!),
    enabled: !!accountId,
  });
}

// --- Interventions ---

async function fetchInterventions(accountId: string): Promise<RevGrowthIntervention[]> {
  const res = await fetch(
    `/api/dashboard/revenue-growth/interventions?accountId=${encodeURIComponent(accountId)}`,
  );
  if (!res.ok) throw new Error("Failed to fetch interventions");
  const data = (await res.json()) as { interventions: RevGrowthIntervention[] };
  return data.interventions ?? [];
}

export function useInterventions(accountId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.revenueGrowth.interventions(accountId ?? ""),
    queryFn: () => fetchInterventions(accountId!),
    enabled: !!accountId,
  });
}

export function useApproveIntervention() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (interventionId: string) => {
      const res = await fetch("/api/dashboard/revenue-growth/interventions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", interventionId }),
      });
      if (!res.ok) throw new Error("Failed to approve intervention");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.revenueGrowth.all });
    },
  });
}

export function useDeferIntervention() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ interventionId, reason }: { interventionId: string; reason: string }) => {
      const res = await fetch("/api/dashboard/revenue-growth/interventions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "defer", interventionId, reason }),
      });
      if (!res.ok) throw new Error("Failed to defer intervention");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.revenueGrowth.all });
    },
  });
}

// --- Digest ---

async function fetchDigest(accountId: string): Promise<RevGrowthDigest | null> {
  const res = await fetch(
    `/api/dashboard/revenue-growth/digest?accountId=${encodeURIComponent(accountId)}`,
  );
  if (!res.ok) throw new Error("Failed to fetch digest");
  const data = (await res.json()) as { digest: RevGrowthDigest | null };
  return data.digest ?? null;
}

export function useDigest(accountId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.revenueGrowth.digest(accountId ?? ""),
    queryFn: () => fetchDigest(accountId!),
    enabled: !!accountId,
  });
}
