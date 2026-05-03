import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";

export interface ApprovalActionPayload {
  note?: string;
}

/**
 * Shared mutation hook for approval responses.
 *
 * Used by:
 *   - /decide list page <RespondDialog>
 *   - /decide/[id] detail page
 *   - /console <ApprovalGateCardView> (inline approve/reject)
 *
 * All surfaces approve/reject through this single hook so they cannot
 * diverge on payload shape, cache invalidation, or error handling.
 *
 * Wraps the existing POST /api/dashboard/approvals contract:
 *   body: { approvalId, action: "approve" | "reject", respondedBy, bindingHash, note? }
 *
 * NOTE: action values are "approve" | "reject" (imperative) to match the
 * upstream API in apps/api/src/routes/approvals.ts. The plan referenced
 * "approved" | "rejected" — that would have failed at runtime against the
 * real API, so the literal preserves current behavior per Task 7's
 * "refactor, not behavior change" constraint. bindingHash is required by
 * the API for approve actions, so it is part of the hook's signature.
 */
export function useApprovalAction(approvalId: string) {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const keys = useScopedQueryKeys();

  const respond = useMutation({
    mutationFn: async (
      input: { action: "approve" | "reject"; bindingHash: string } & ApprovalActionPayload,
    ) => {
      const respondedBy =
        (session as unknown as { principalId?: string } | null)?.principalId ?? "dashboard-user";
      const res = await fetch("/api/dashboard/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approvalId,
          action: input.action,
          respondedBy,
          bindingHash: input.bindingHash,
          ...(input.note !== undefined ? { note: input.note } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? `Approval action failed (HTTP ${res.status})`,
        );
      }
      return res.json();
    },
    onSuccess: () => {
      if (keys) {
        queryClient.invalidateQueries({ queryKey: keys.approvals.pending() });
        queryClient.invalidateQueries({ queryKey: keys.approvals.all() });
        queryClient.invalidateQueries({ queryKey: keys.audit.all() });
      }
    },
  });

  return {
    approve: (bindingHash: string, note?: string) =>
      respond.mutateAsync({ action: "approve", bindingHash, note }),
    reject: (bindingHash: string, note?: string) =>
      respond.mutateAsync({ action: "reject", bindingHash, note }),
    isPending: respond.isPending,
    error: respond.error,
  };
}
