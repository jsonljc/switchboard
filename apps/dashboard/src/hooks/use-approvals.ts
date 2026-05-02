"use client";

import { useQuery } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";

interface PendingApproval {
  id: string;
  summary: string;
  riskCategory: string;
  status: string;
  envelopeId: string;
  expiresAt: string;
  bindingHash: string;
  createdAt: string;
}

async function fetchPendingApprovals(): Promise<{ approvals: PendingApproval[] }> {
  const res = await fetch("/api/dashboard/approvals");
  if (!res.ok) throw new Error("Failed to fetch approvals");
  return res.json();
}

export function useApprovals() {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys?.approvals.pending() ?? ["__disabled_approvals_pending__"],
    queryFn: fetchPendingApprovals,
    // 60s: frequent enough to surface new approvals promptly without hammering the API
    refetchInterval: 60_000,
    enabled: !!keys,
  });
}

export function useApprovalCount() {
  const { data } = useApprovals();
  return data?.approvals.length ?? 0;
}
