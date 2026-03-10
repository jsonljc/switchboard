"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { formatCountdown, formatRelativeTime } from "@/lib/utils";

interface ApprovalCardProps {
  approval: {
    id: string;
    summary: string;
    riskCategory: string;
    expiresAt: string;
    bindingHash: string;
    createdAt: string;
  };
  onApprove: (id: string, bindingHash: string) => void;
  onReject: (id: string) => void;
}

/* ─── Consequence copy by risk level ─── */
const CONSEQUENCE: Record<string, string> = {
  low: "Routine — your assistant asked as a precaution.",
  medium: "This affects a customer or involves money.",
  high: "This is significant — take a moment to review.",
  critical: "This is significant — take a moment to review.",
};

function consequenceCopy(riskCategory: string): string {
  return CONSEQUENCE[riskCategory] ?? CONSEQUENCE.medium;
}

export function ApprovalCard({ approval, onApprove, onReject }: ApprovalCardProps) {
  const [countdown, setCountdown] = useState(() => formatCountdown(approval.expiresAt));
  const isExpired = countdown === "expired";

  // Urgent = less than 60 minutes remaining
  const isUrgent =
    !isExpired && new Date(approval.expiresAt).getTime() - Date.now() < 60 * 60 * 1000;

  useEffect(() => {
    // Poll more frequently when close to expiry
    const getInterval = () => {
      const remaining = new Date(approval.expiresAt).getTime() - Date.now();
      return remaining < 5 * 60 * 1000 ? 5_000 : 30_000;
    };
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setCountdown(formatCountdown(approval.expiresAt));
      timer = setTimeout(tick, getInterval());
    };
    timer = setTimeout(tick, getInterval());
    return () => clearTimeout(timer);
  }, [approval.expiresAt]);

  return (
    <div
      className={cn(
        "rounded-xl border bg-surface p-6 space-y-4 transition-colors duration-default",
        isExpired ? "opacity-60 border-border/50" : "border-border",
        isUrgent && "border-l-[3px] border-l-caution",
      )}
    >
      {/* Timestamp */}
      <p className="section-label">{formatRelativeTime(approval.createdAt)}</p>

      {/* Summary — what the AI wants to do */}
      <p className="text-[15px] text-foreground leading-relaxed">{approval.summary}</p>

      {/* Plain-English consequence */}
      {!isExpired && (
        <p className="text-[13px] text-muted-foreground italic leading-snug">
          {consequenceCopy(approval.riskCategory)}
        </p>
      )}

      {/* Expiry line — sets expectations for doing nothing */}
      {!isExpired && (
        <p className="text-[12px] text-muted-foreground">
          Expires in {countdown} — if you wait, nothing will change.
        </p>
      )}

      {/* Expired state */}
      {isExpired && (
        <p className="text-[13px] text-muted-foreground">
          This request expired. Nothing was changed.
        </p>
      )}

      {/* Actions */}
      {!isExpired && (
        <div className="flex items-center gap-3 pt-1 border-t border-border/60">
          <button
            onClick={() => onApprove(approval.id, approval.bindingHash)}
            className="px-5 py-2.5 rounded-lg text-[13px] font-medium bg-positive text-positive-foreground hover:opacity-90 transition-opacity"
          >
            Approve
          </button>
          <button
            onClick={() => onReject(approval.id)}
            className="px-4 py-2.5 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Not now
          </button>
        </div>
      )}
    </div>
  );
}
