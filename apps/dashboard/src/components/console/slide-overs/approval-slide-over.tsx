"use client";

import Link from "next/link";
import { ConsoleSlideOver } from "./console-slide-over";
import { useApprovalAction } from "@/hooks/use-approval-action";

interface ApprovalSlideOverProps {
  approvalId: string;
  bindingHash: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Slide-over for approving or rejecting an approval gate from /console.
 *
 * Consumes the shared `useApprovalAction(approvalId)` hook so this surface
 * cannot diverge from `/decide/[id]` on payload shape, cache invalidation,
 * or error handling. The hook requires `bindingHash` per the API contract;
 * the caller passes it through so the slide-over has it at click time.
 *
 * "Open full detail →" deep-links to `/decide/[approvalId]` for the binding
 * hash transcript, conversation context, and full history.
 */
export function ApprovalSlideOver({
  approvalId,
  bindingHash,
  open,
  onOpenChange,
}: ApprovalSlideOverProps) {
  const { approve, reject, isPending } = useApprovalAction(approvalId);

  const handleApprove = async () => {
    await approve(bindingHash);
    onOpenChange(false);
  };
  const handleReject = async () => {
    await reject(bindingHash);
    onOpenChange(false);
  };

  return (
    <ConsoleSlideOver open={open} onOpenChange={onOpenChange} title="Approve or reject">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Approval {approvalId}. Choose an action below, or open the full detail page for the
          binding hash transcript, history, and conversation context.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleApprove}
            disabled={isPending}
            className="btn btn-primary-graphite"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={handleReject}
            disabled={isPending}
            className="btn btn-ghost"
          >
            Reject
          </button>
        </div>
        <Link
          href={`/decide/${approvalId}`}
          className="block text-sm text-muted-foreground underline"
        >
          Open full detail →
        </Link>
      </div>
    </ConsoleSlideOver>
  );
}
