"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";

export function useGovernanceStatus() {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys?.governance.status("current") ?? ["__disabled_governance_status__"],
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
    enabled: !!keys,
  });
}

export function useEmergencyHalt() {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
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
      if (keys) queryClient.invalidateQueries({ queryKey: keys.governance.all() });
    },
  });
}

export function useResume() {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/dashboard/governance/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data: unknown = await res.json().catch(() => ({}));
        const body = data as {
          error?: string;
          readiness?: {
            ready?: boolean;
            checks?: Array<{ id: string; label: string; status: string; blocking?: boolean }>;
          };
        };
        // Surface structured readiness blockers when the proxy forwards the
        // upstream 400 body verbatim (checks use status:"fail", not ok:false).
        if (Array.isArray(body.readiness?.checks)) {
          const failed = body.readiness.checks.filter((c) => c.status === "fail");
          if (failed.length > 0) {
            const labels = failed.map((c) => c.label).join(", ");
            throw new Error(`Cannot resume — blockers: ${labels}`);
          }
          // readiness present but no failed checks (edge case)
          throw new Error("Cannot resume — readiness checks did not pass");
        }
        throw new Error(body.error ?? "Failed to resume");
      }
      return res.json();
    },
    onSuccess: () => {
      if (keys) queryClient.invalidateQueries({ queryKey: keys.governance.all() });
    },
  });
}

export function useReadiness(agentId = "alex") {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys?.readiness.check(agentId) ?? ["__disabled_readiness_check__"],
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
    enabled: !!keys,
  });
}
