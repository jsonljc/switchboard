"use client";

import { useApprovalCount } from "@/hooks/use-approvals";
import { useAgentRoster, useAgentState } from "@/hooks/use-agents";

export function StatusHero() {
  const pendingCount = useApprovalCount();
  const { data: stateData } = useAgentState();
  const { data: rosterData } = useAgentRoster();
  const hasErrors = stateData?.states?.some((s) => s.activityStatus === "error") ?? false;
  const needsAttention = pendingCount > 0 || hasErrors;

  const primaryOperator = rosterData?.roster?.find((a) => a.agentRole === "primary_operator");
  const operatorName = primaryOperator?.displayName ?? "Your assistant";

  return (
    <div
      className={`rounded-lg border p-6 ${
        needsAttention
          ? "bg-agent-attention/5 border-agent-attention/20"
          : "bg-primary/[0.04] border-primary/10"
      }`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`h-2.5 w-2.5 rounded-full ${
            needsAttention ? "bg-agent-attention animate-pulse" : "bg-agent-active"
          }`}
        />
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {needsAttention
            ? `${operatorName} needs your attention`
            : `${operatorName} is running smoothly`}
        </h1>
      </div>
      {!needsAttention && (
        <p className="text-sm text-muted-foreground mt-1 ml-6">
          Everything is running smoothly. Your assistant is working in the background.
        </p>
      )}
    </div>
  );
}
