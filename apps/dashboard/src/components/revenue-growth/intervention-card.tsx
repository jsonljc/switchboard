"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { RevGrowthIntervention } from "@/lib/api-client";
import { DeferDialog } from "./defer-dialog";

interface InterventionCardProps {
  intervention: RevGrowthIntervention;
  onApprove: (id: string) => void;
  onDefer: (id: string, reason: string) => void;
  isApproving?: boolean;
  isDeferring?: boolean;
}

const ACTION_TYPE_LABELS: Record<string, string> = {
  FIX_TRACKING: "Fix Tracking",
  REFRESH_CREATIVE: "Refresh Creative",
  OPTIMIZE_FUNNEL: "Optimize Funnel",
  IMPROVE_SALES_PROCESS: "Improve Sales",
  EXPAND_AUDIENCE: "Expand Audience",
  REVISE_OFFER: "Revise Offer",
  SCALE_CAPACITY: "Scale Capacity",
};

const IMPACT_COLORS: Record<string, string> = {
  HIGH: "text-positive-foreground bg-positive/15",
  MEDIUM: "text-caution-foreground bg-caution/15",
  LOW: "text-muted-foreground bg-muted",
};

const STATUS_COLORS: Record<string, string> = {
  PROPOSED: "bg-caution/15 text-caution-foreground",
  APPROVED: "bg-positive/15 text-positive-foreground",
  EXECUTED: "bg-positive/15 text-positive-foreground",
  DEFERRED: "bg-muted text-muted-foreground",
  REJECTED: "bg-destructive/15 text-destructive",
};

export function InterventionCard({
  intervention,
  onApprove,
  onDefer,
  isApproving,
  isDeferring,
}: InterventionCardProps) {
  const [deferOpen, setDeferOpen] = useState(false);
  const isProposed = intervention.status === "PROPOSED";

  return (
    <>
      <div className="rounded-xl border border-border/60 bg-surface p-4 space-y-3">
        {/* Header: action type + status + impact */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[12px] font-medium text-foreground bg-muted/50 px-2 py-0.5 rounded-md">
            {ACTION_TYPE_LABELS[intervention.actionType] ?? intervention.actionType}
          </span>
          <span
            className={cn(
              "text-[10px] font-medium px-2 py-0.5 rounded-full",
              STATUS_COLORS[intervention.status] ?? "bg-muted text-muted-foreground",
            )}
          >
            {intervention.status}
          </span>
          <span
            className={cn(
              "text-[10px] font-medium px-2 py-0.5 rounded-full",
              IMPACT_COLORS[intervention.estimatedImpact] ?? "bg-muted text-muted-foreground",
            )}
          >
            {intervention.estimatedImpact} impact
          </span>
        </div>

        {/* Reasoning */}
        <p className="text-[13px] text-muted-foreground leading-relaxed">
          {intervention.reasoning}
        </p>

        {/* Actions */}
        {isProposed && (
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => onApprove(intervention.id)}
              disabled={isApproving}
              className="text-[12px] font-medium text-positive-foreground bg-positive/15 hover:bg-positive/25 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {isApproving ? "Approving..." : "Approve"}
            </button>
            <button
              onClick={() => setDeferOpen(true)}
              disabled={isDeferring}
              className="text-[12px] font-medium text-muted-foreground bg-muted/50 hover:bg-muted px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {isDeferring ? "Deferring..." : "Defer"}
            </button>
          </div>
        )}
      </div>

      <DeferDialog
        open={deferOpen}
        onOpenChange={setDeferOpen}
        onConfirm={(reason) => {
          onDefer(intervention.id, reason);
          setDeferOpen(false);
        }}
      />
    </>
  );
}
