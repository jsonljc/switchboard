"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../lib/query-keys";

export function useGovernanceStatus() {
  return useQuery({
    queryKey: queryKeys.governance.status("current"),
    queryFn: async () => {
      const res = await fetch("/api/dashboard/governance/status");
      if (!res.ok) throw new Error("Failed to fetch governance status");
      return res.json() as Promise<{
        profile: string;
        posture: string;
        deploymentStatus: string;
        haltedAt: string | null;
        haltReason: string | null;
      }>;
    },
  });
}

export function useEmergencyHalt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (reason?: string) => {
      const res = await fetch("/api/dashboard/governance/halt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) throw new Error("Failed to halt");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.governance.all });
    },
  });
}

export function useResume() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/dashboard/governance/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) return data;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.governance.all });
    },
  });
}

export function useReadiness(agentId = "alex") {
  return useQuery({
    queryKey: queryKeys.readiness.check(agentId),
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/agents/${agentId}/readiness`);
      if (!res.ok) throw new Error("Failed to fetch readiness");
      return res.json() as Promise<{
        ready: boolean;
        checks: Array<{
          id: string;
          label: string;
          status: "pass" | "fail";
          message: string;
          blocking: boolean;
        }>;
      }>;
    },
  });
}
