"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import { isMercuryToolLive } from "@/lib/route-availability";
import { APPROVALS_FIXTURES } from "../fixtures";
import type { PendingRow, DetailRow } from "../types";
import { useSessionPrincipal } from "./use-session-principal";

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

export function useApprovalDetail(id: string | null) {
  const keys = useScopedQueryKeys();
  const live = isLive();

  return useQuery<DetailRow>({
    queryKey:
      keys?.approvals.detail(id ?? "__none__") ?? (["__disabled_approval_detail__", id] as const),
    queryFn: async () => {
      if (!id) throw new Error("missing id");
      if (!live) {
        const row = APPROVALS_FIXTURES.find((r) => r.id === id);
        if (!row) throw new Error(`fixture not found: ${id}`);
        return row;
      }
      const res = await fetch(`/api/dashboard/approvals?id=${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(`Failed to load approval: ${res.status}`);
      return res.json() as Promise<DetailRow>;
    },
    enabled: !!id && (!live || !!keys),
    staleTime: 5_000,
  });
}

// ---------------------------------------------------------------------------
// Respond mutation
// ---------------------------------------------------------------------------

export interface RespondInput {
  id: string;
  action: "approve" | "reject" | "patch";
  bindingHash?: string;
  patchValue?: Record<string, unknown>;
}

export class ApprovalRespondError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "ApprovalRespondError";
  }
}

export function useRespondToApproval() {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
  const principalId = useSessionPrincipal();

  return useMutation({
    mutationFn: async (input: RespondInput) => {
      if (!principalId) throw new ApprovalRespondError("No session principal", 401);
      const body: Record<string, unknown> = {
        approvalId: input.id,
        action: input.action,
        respondedBy: principalId,
      };
      if (input.action !== "reject") body.bindingHash = input.bindingHash;
      if (input.action === "patch") body.patchValue = input.patchValue;

      const res = await fetch("/api/dashboard/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let detail = "Request failed";
        try {
          const data = (await res.json()) as { error?: string };
          if (data?.error) detail = data.error;
        } catch {
          /* fall through with default */
        }
        throw new ApprovalRespondError(detail, res.status);
      }
      return res.json();
    },
    onSuccess: () => {
      if (keys) {
        queryClient.invalidateQueries({ queryKey: keys.approvals.all() });
        // Defensive: if/when the decision feed surfaces approvals, ensure both
        // caches drop together (amendment I).
        queryClient.invalidateQueries({ queryKey: keys.decisions.all() });
      }
    },
  });
}
