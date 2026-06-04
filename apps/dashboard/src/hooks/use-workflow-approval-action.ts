"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";

interface RespondInput {
  action: "approve" | "reject";
  bindingHash?: string;
  note?: string;
}

export interface WorkflowApprovalSettled {
  silent?: boolean;
  staleBinding?: boolean;
  body?: unknown;
}

/**
 * Approve/reject a parked governed-workflow approval (an ApprovalLifecycle id)
 * through the dashboard approvals proxy -> POST /api/approvals/:id/respond.
 * respondedBy is NEVER sent: the API derives it from the authenticated
 * principal. Error handling branches on the API's structured `code`:
 *  - already_responded | expired -> silent success (someone settled it; refetch clears)
 *  - stale_binding -> staleBinding flag (caller shows "This approval changed. Refreshing.")
 *  - anything else -> thrown Error with the server message
 */
export function useWorkflowApprovalAction(lifecycleId: string) {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();

  const invalidate = () => {
    if (keys) {
      void queryClient.invalidateQueries({ queryKey: keys.decisions.all() });
      void queryClient.invalidateQueries({ queryKey: keys.audit.all() });
    }
  };

  const respond = useMutation({
    mutationFn: async (input: RespondInput): Promise<WorkflowApprovalSettled | unknown> => {
      if (input.action === "approve" && !input.bindingHash) {
        throw new Error(
          "This approval is missing its integrity record and cannot be approved from here.",
        );
      }
      const res = await fetch("/api/dashboard/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approvalId: lifecycleId,
          action: input.action,
          ...(input.bindingHash !== undefined ? { bindingHash: input.bindingHash } : {}),
          ...(input.note !== undefined ? { note: input.note } : {}),
        }),
      });
      if (res.ok) return res.json();
      const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      if (body.code === "already_responded" || body.code === "expired") {
        return { silent: true, body };
      }
      if (body.code === "stale_binding") {
        invalidate();
        return { staleBinding: true, body };
      }
      throw new Error(body.error ?? `Approval action failed (HTTP ${res.status})`);
    },
    onSuccess: invalidate,
  });

  return {
    approve: (bindingHash: string, note?: string) =>
      respond.mutateAsync({ action: "approve", bindingHash, note }),
    reject: (note?: string) => respond.mutateAsync({ action: "reject", note }),
    isPending: respond.isPending,
    error: respond.error,
  };
}
