import type { OpportunityStage } from "@switchboard/schemas";
import type { SalesPipelineAgentRole } from "./role-prompts.js";

export interface PipelineState {
  opportunityStage: OpportunityStage;
  assignedAgent: SalesPipelineAgentRole;
  messageCount: number;
  lastCustomerReplyAt: Date | null;
  dormancyThresholdHours: number;
}

export type HandoffResult =
  | { action: "none" }
  | { action: "handoff" | "go-dormant"; toAgent: SalesPipelineAgentRole; reason: string };

const STAGE_TO_AGENT: Partial<Record<OpportunityStage, SalesPipelineAgentRole>> = {
  interested: "speed-to-lead",
  qualified: "sales-closer",
  nurturing: "nurture-specialist",
};

const TERMINAL_STAGES: OpportunityStage[] = ["won", "lost"];

export function determineHandoff(state: PipelineState): HandoffResult {
  // Terminal stages — no handoff
  if (TERMINAL_STAGES.includes(state.opportunityStage)) {
    return { action: "none" };
  }

  // Check for dormancy (before stage-based handoff)
  if (
    state.lastCustomerReplyAt &&
    state.opportunityStage !== "nurturing" &&
    state.assignedAgent !== "nurture-specialist"
  ) {
    const hoursSinceReply = (Date.now() - state.lastCustomerReplyAt.getTime()) / (1000 * 60 * 60);
    if (hoursSinceReply > state.dormancyThresholdHours) {
      return {
        action: "go-dormant",
        toAgent: "nurture-specialist",
        reason: `No customer reply for ${Math.round(hoursSinceReply)} hours, entering nurture`,
      };
    }
  }

  // Stage-based handoff
  const expectedAgent = STAGE_TO_AGENT[state.opportunityStage];
  if (expectedAgent && expectedAgent !== state.assignedAgent) {
    const reasons: Record<SalesPipelineAgentRole, string> = {
      "speed-to-lead": "Re-engaged lead needs qualification",
      "sales-closer": "Lead qualified, transitioning to Sales Closer",
      "nurture-specialist": "Lead entered nurturing stage",
    };
    return {
      action: "handoff",
      toAgent: expectedAgent,
      reason: reasons[expectedAgent],
    };
  }

  return { action: "none" };
}
