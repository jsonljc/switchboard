import type { ContactStage, OpportunityStage } from "@switchboard/schemas";

interface OpportunityStageSummary {
  stage: OpportunityStage;
}

const TERMINAL_STAGES: OpportunityStage[] = ["won", "lost"];

export function deriveContactStage(
  opportunities: OpportunityStageSummary[],
  lastActivityAt: Date,
  thresholdDays: number,
): ContactStage {
  if (opportunities.length === 0) {
    return "new";
  }

  const hasWon = opportunities.some((o) => o.stage === "won");
  const hasActive = opportunities.some((o) => !TERMINAL_STAGES.includes(o.stage));
  const daysSinceActivity = (Date.now() - lastActivityAt.getTime()) / (1000 * 60 * 60 * 24);
  const isRecent = daysSinceActivity < thresholdDays;

  if (hasWon && hasActive) return "retained";
  if (hasWon && !hasActive && isRecent) return "customer";
  if (hasWon && !hasActive && !isRecent) return "dormant";
  if (!hasWon && hasActive) return "active";
  // v1 approximation: recent activity but no active opps — still considered active
  if (!hasWon && !hasActive && isRecent) return "active";
  return "dormant";
}
