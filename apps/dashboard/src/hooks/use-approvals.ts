"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

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
  return useQuery({
    queryKey: queryKeys.approvals.pending(),
    queryFn: fetchPendingApprovals,
    // 60s: frequent enough to surface new approvals promptly without hammering the API
    refetchInterval: 60_000,
  });
}

export function useApprovalCount() {
  const { data } = useApprovals();
  return data?.approvals.length ?? 0;
}
