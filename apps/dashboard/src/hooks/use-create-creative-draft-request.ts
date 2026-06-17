"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { MiraBriefRequest, MiraBriefResponse } from "@switchboard/schemas";
import { useScopedQueryKeys } from "./use-query-keys";
import { createIdempotencyKey } from "@/lib/idempotency";

/**
 * Outcome of an open-brief submission. The governance gate PARKS a brief whose
 * render-cost signal trips the spend-approval threshold: the proxy answers with a
 * PENDING_APPROVAL envelope (202) and NO draft was started. Surfacing it as a
 * discriminated result (not the submitted `{ jobId }` shape) stops the desk from
 * treating a parked brief as a phantom success. Mirrors ApproveStageResult.
 */
export type CreateDraftResult =
  | { pendingApproval: false; jobId: string }
  | { pendingApproval: true; approvalRequest?: { id: string; bindingHash?: string } };

/** createCreativeDraftRequest — draft-only. Generates a per-submission idempotency key. */
export function useCreateCreativeDraftRequest() {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
  return useMutation({
    mutationFn: async (brief: MiraBriefRequest): Promise<CreateDraftResult> => {
      const res = await fetch("/api/dashboard/agents/mira/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": createIdempotencyKey() },
        body: JSON.stringify(brief),
      });
      if (!res.ok) throw new Error(`Brief submission failed (HTTP ${res.status})`);
      const data = (await res.json()) as MiraBriefResponse;
      // Governance parked this brief above the spend threshold: NOT a draft. The
      // PENDING_APPROVAL envelope is the only response shape carrying `outcome`.
      if ("outcome" in data) {
        return { pendingApproval: true, approvalRequest: data.approvalRequest };
      }
      return { pendingApproval: false, jobId: data.jobId };
    },
    onSuccess: () => {
      if (keys) void queryClient.invalidateQueries({ queryKey: keys.miraFeed.all() });
    },
  });
}
