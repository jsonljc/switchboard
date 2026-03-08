"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

export interface AutonomyAssessment {
  currentProfile: string;
  recommendedProfile: string;
  autonomousEligible: boolean;
  reason: string;
  progressPercent: number;
  stats: {
    totalSuccesses: number;
    totalFailures: number;
    competenceScore: number;
    failureRate: number;
  };
}

async function fetchOperatorConfig() {
  const res = await fetch("/api/dashboard/operator-config");
  if (!res.ok) throw new Error("Failed to fetch operator config");
  return res.json() as Promise<{
    config: {
      active: boolean;
      automationLevel: "copilot" | "supervised" | "autonomous";
      [key: string]: unknown;
    };
  }>;
}

async function fetchAutonomyAssessment() {
  const res = await fetch("/api/dashboard/operator-config/autonomy");
  if (!res.ok) throw new Error("Failed to fetch autonomy assessment");
  return res.json() as Promise<{ assessment: AutonomyAssessment }>;
}

export function useOperatorConfig() {
  return useQuery({
    queryKey: queryKeys.operatorConfig.current(),
    queryFn: fetchOperatorConfig,
  });
}

export function useAutonomyAssessment() {
  return useQuery({
    queryKey: queryKeys.operatorConfig.autonomy(),
    queryFn: fetchAutonomyAssessment,
  });
}

export function useUpdateOperatorConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (updates: Record<string, unknown>) => {
      const res = await fetch("/api/dashboard/operator-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Failed to update operator config");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.operatorConfig.all });
    },
  });
}
