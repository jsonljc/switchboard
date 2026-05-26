// apps/dashboard/src/lib/cockpit/alex/alex-approval-row.tsx
"use client";

import { useState } from "react";
import { ApprovalCard } from "@/components/cockpit/approval-card";
import { ConfirmSheet } from "@/components/decisions/swipe-decision-card";
import { needsConfirm } from "@/lib/decisions/swipe-policy";
import { useRespondToApproval } from "@/lib/cockpit/approvals/use-approvals";
import { useToast } from "@/components/ui/use-toast";
import { ALEX_VARIANTS, DEFAULT_ALEX_VARIANT } from "@/lib/cockpit/alex-config";
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
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (dismissed) return null;

  // Commit a resolved verdict via the respond mutation. Accept includes the
  // bindingHash; decline omits it (`use-approvals.ts:113` forwards bindingHash
  // only when action !== "reject"). Optimistically hides the card, reverting on
  // error. Per spec criterion 6 (toast voice): emit the view's acceptToast /
  // declineToast copy when populated, else the generic "Approved"/"Declined" —
  // the single-owner-toast doctrine: the row owns this, not the shared card.
  function dispatch(verdict: "accept" | "decline") {
    if (approval.primaryAction.kind !== "respond") return; // narrowed; guarded in handleResolve
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

    const successTitle =
      verdict === "accept"
        ? (approval.acceptToast ?? "Approved")
        : (approval.declineToast ?? "Declined");

    respond.mutate(input, {
      onSuccess: () => {
        toast({
          title: successTitle,
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

  function handleResolve(verdict: "accept" | "decline") {
    // The legacy adapter (`legacy-pending-approval-to-approval-view.ts:45`)
    // currently emits only `primaryAction.kind === "respond"` for Alex; the
    // `"internal"` branch is reserved for future kinds (e.g., escalation
    // handoffs) and lands explicitly in A.7c when the rich adapter ships.
    if (approval.primaryAction.kind !== "respond") {
      // Defensive guard: when the rich adapter eventually emits
      // `kind === "internal"` primary actions for Alex, the dispatch must go
      // through `useAlexActionDispatcher` instead of `useRespondToApproval`.
      // The legacy adapter currently never produces this branch on production
      // data, so this path stays unreachable until the rich adapter is wired.
      // eslint-disable-next-line no-console
      console.warn(
        `AlexApprovalRow: unsupported primaryAction.kind=${approval.primaryAction.kind}`,
      );
      return;
    }
    if (verdict === "accept") {
      // Safety gate (mirrors the #696 InboxDrawer fix): the cockpit view-model
      // carries no risk contract, so this is the missing-contract ⇒ unsafe path
      // — require an explicit confirm before committing. No approval commits in
      // a single tap on the legacy cockpit. Decline is always allowed.
      if (needsConfirm(approval.riskContract)) {
        setConfirmOpen(true);
        return;
      }
    }
    dispatch(verdict);
  }

  return (
    <>
      <ApprovalCard
        data={approval}
        idx={idx}
        total={total}
        onResolve={(verdict) => handleResolve(verdict)}
        senderLabel="Alex needs you"
        bundle={ALEX_VARIANTS}
        variant={DEFAULT_ALEX_VARIANT}
      />
      <ConfirmSheet
        open={confirmOpen}
        agentName="Alex"
        summary={approval.title}
        affirmativeLabel={approval.primary}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          dispatch("accept");
        }}
      />
    </>
  );
}
