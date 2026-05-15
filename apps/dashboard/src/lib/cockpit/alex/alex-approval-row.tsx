// apps/dashboard/src/lib/cockpit/alex/alex-approval-row.tsx
"use client";

import { useState } from "react";
import { ApprovalCard } from "@/components/cockpit/approval-card";
import { useRespondToApproval } from "@/app/(auth)/(mercury)/approvals/hooks/use-approvals";
import { useToast } from "@/components/ui/use-toast";
import type { AlexApprovalView } from "@/components/cockpit/types";

/**
 * AlexApprovalRow owns the per-approval respond mutation, the optimistic
 * dismiss state, and the single success/error toast for an Alex approval row.
 *
 * The cockpit page is intentionally agnostic of audit-domain glue (per the
 * `[[riley-b3-followup-shipped]]` single-owner-toast doctrine and the
 * `[[alex-cockpit-a5-shipped]]` toast-boundary lock): both `useRespondToApproval`
 * and `useToast` are consumed here, never inside `components/cockpit/`.
 *
 * Verdict-to-action translation (locked by the A.7b brief design §A.7b):
 * - Accept → `mutate({ id, action: "approve", bindingHash })`
 * - Decline → `mutate({ id, action: "reject" })` (no bindingHash, per
 *   `use-approvals.ts:113` which only forwards bindingHash when action !== "reject")
 */
export interface AlexApprovalRowProps {
  approval: AlexApprovalView;
  idx: number;
  total: number;
}

export function AlexApprovalRow({ approval, idx, total }: AlexApprovalRowProps) {
  const respond = useRespondToApproval();
  const { toast } = useToast();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  function handleResolve(verdict: "accept" | "decline") {
    // The legacy adapter (`legacy-pending-approval-to-approval-view.ts:45`)
    // currently emits only `primaryAction.kind === "respond"` for Alex; the
    // `"internal"` branch is reserved for future kinds (e.g., escalation
    // handoffs) and lands explicitly in A.7c when the rich adapter ships.
    if (approval.primaryAction.kind !== "respond") {
      // TODO(A.7c): route `kind === "internal"` through
      // `useAlexActionDispatcher` once the rich adapter emits non-respond
      // primary actions. Until then the legacy adapter never produces this
      // branch, so this is unreachable on production data.
      // eslint-disable-next-line no-console
      console.warn(
        `AlexApprovalRow: unsupported primaryAction.kind=${approval.primaryAction.kind} (A.7c)`,
      );
      return;
    }

    setDismissed(true); // optimistic
    const input =
      verdict === "accept"
        ? {
            id: approval.id,
            action: "approve" as const,
            bindingHash: approval.primaryAction.bindingHash,
          }
        : {
            id: approval.id,
            action: "reject" as const,
          };

    respond.mutate(input, {
      onSuccess: () => {
        toast({
          title: verdict === "accept" ? "Approved" : "Declined",
          description: approval.title,
        });
      },
      onError: () => {
        setDismissed(false); // revert optimistic dismiss
        toast({
          title: "Could not respond",
          description: "Please retry.",
          variant: "destructive",
        });
      },
    });
  }

  return (
    <ApprovalCard
      data={approval}
      idx={idx}
      total={total}
      onResolve={(verdict) => handleResolve(verdict)}
      senderLabel="Alex needs you"
    />
  );
}
