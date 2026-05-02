"use client";

import Link from "next/link";
import { useState } from "react";
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
 * On success: close the slide-over.
 * On failure: keep the slide-over open and surface the error inline so the
 * operator gets a clear signal — mirrors `<EscalationSlideOver>`'s pattern.
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
  const [error, setError] = useState<string | null>(null);

  const handleApprove = async () => {
    setError(null);
    try {
      await approve(bindingHash);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approval failed.");
    }
  };

  const handleReject = async () => {
    setError(null);
    try {
      await reject(bindingHash);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rejection failed.");
    }
  };

  return (
    <ConsoleSlideOver open={open} onOpenChange={onOpenChange} title="Approve or reject">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Approval {approvalId}. Choose an action below, or open the full detail page for the
          binding hash transcript, history, and conversation context.
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
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
