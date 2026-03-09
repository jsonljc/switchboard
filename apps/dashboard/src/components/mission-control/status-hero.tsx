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
  const operatorName = primaryOperator?.displayName ?? "Your AI team";

  return (
    <div
      className={`rounded-lg border p-6 ${
        needsAttention
          ? "bg-agent-attention/5 border-agent-attention/30"
          : "bg-agent-active/5 border-agent-active/30"
      }`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`h-3 w-3 rounded-full ${
            needsAttention ? "bg-agent-attention animate-pulse" : "bg-agent-active"
          }`}
        />
        <h2 className="text-lg font-semibold">
          {needsAttention
            ? `${operatorName} needs your attention`
            : `${operatorName} is running smoothly`}
        </h2>
      </div>
      {!needsAttention && (
        <p className="text-sm text-muted-foreground mt-1 ml-6">
          All systems operational. Your team is working in the background.
        </p>
      )}
    </div>
  );
}
