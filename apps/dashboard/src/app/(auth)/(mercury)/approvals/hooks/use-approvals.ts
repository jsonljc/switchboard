"use client";

import { useQuery } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import { isMercuryToolLive } from "@/lib/route-availability";
import { APPROVALS_FIXTURES } from "../fixtures";
import type { PendingRow } from "../types";

const isLive = (): boolean => isMercuryToolLive("approvals");

interface PendingResponse {
  approvals: PendingRow[];
}

/**
 * Project the rich fixture rows down to the wire-truthful PendingApproval shape.
 * The detail call (useApprovalDetail) is the only place rich fields appear.
 * Mirroring this boundary in fixture mode prevents "looks great in dev, breaks
 * in prod when /pending returns less than the UI assumed".
 */
const FIXTURE_RESPONSE: PendingResponse = {
  approvals: APPROVALS_FIXTURES.map((row) => ({
    id: row.id,
    summary: row.summary,
    riskCategory: row.riskCategory,
    status: row.status,
    envelopeId: row.envelopeId,
    expiresAt: row.expiresAt,
    bindingHash: row.bindingHash,
    createdAt: row.createdAt,
  })),
};

export function usePendingApprovals() {
  const keys = useScopedQueryKeys();
  const live = isLive();

  return useQuery<PendingResponse>({
    queryKey: keys?.approvals.pending() ?? (["__disabled_approvals_pending__"] as const),
    queryFn: async () => {
      if (!live) return FIXTURE_RESPONSE;
      const res = await fetch("/api/dashboard/approvals");
      if (!res.ok) throw new Error(`Failed to load approvals: ${res.status}`);
      return res.json() as Promise<PendingResponse>;
    },
    enabled: !live || !!keys,
    staleTime: live ? 30_000 : Infinity,
    // Suppress the React Query default (true) in fixture mode so the dev page
    // doesn't churn on tab focus. In live mode the default refetch-on-focus
    // is the explicit refresh signal — no refetchInterval (live countdown is
    // client-side; refetch is event-driven).
    refetchOnWindowFocus: live,
  });
}
