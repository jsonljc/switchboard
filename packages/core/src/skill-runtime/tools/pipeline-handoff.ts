import type { SkillTool } from "../types.js";
import { ok } from "../tool-result.js";
import type { OpportunityStage } from "@switchboard/schemas";

type AgentRole = "speed-to-lead" | "sales-closer" | "nurture-specialist";

interface HandoffInput {
  opportunityStage: OpportunityStage;
  assignedAgent: AgentRole;
  lastCustomerReplyAt: string | null;
  dormancyThresholdHours: number;
}

type HandoffResult =
  | { action: "none" }
  | { action: "handoff" | "go-dormant"; toAgent: AgentRole; reason: string };

const TERMINAL_STAGES: OpportunityStage[] = ["won", "lost"];

const STAGE_TO_AGENT: Partial<Record<OpportunityStage, AgentRole>> = {
  interested: "speed-to-lead",
  qualified: "sales-closer",
  nurturing: "nurture-specialist",
};

function determine(input: HandoffInput): HandoffResult {
  if (TERMINAL_STAGES.includes(input.opportunityStage)) {
    return { action: "none" };
  }

  if (
    input.lastCustomerReplyAt &&
    input.opportunityStage !== "nurturing" &&
    input.assignedAgent !== "nurture-specialist"
  ) {
    const hoursSinceReply =
      (Date.now() - new Date(input.lastCustomerReplyAt).getTime()) / (1000 * 60 * 60);
    if (hoursSinceReply > input.dormancyThresholdHours) {
      return {
        action: "go-dormant",
        toAgent: "nurture-specialist",
        reason: `No customer reply for ${Math.round(hoursSinceReply)} hours, entering nurture`,
      };
    }
  }

  const expectedAgent = STAGE_TO_AGENT[input.opportunityStage];
  if (expectedAgent && expectedAgent !== input.assignedAgent) {
    const reasons: Record<AgentRole, string> = {
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

export function createPipelineHandoffTool(): SkillTool {
  return {
    id: "pipeline-handoff",
    operations: {
      determine: {
        description:
          "Check if a lead should be handed off to a different pipeline agent based on current stage and time since last customer reply.",
        effectCategory: "read" as const,
        idempotent: true,
        inputSchema: {
          type: "object",
          properties: {
            opportunityStage: {
              type: "string",
              enum: [
                "interested",
                "qualified",
                "quoted",
                "booked",
                "showed",
                "won",
                "lost",
                "nurturing",
              ],
            },
            assignedAgent: {
              type: "string",
              enum: ["speed-to-lead", "sales-closer", "nurture-specialist"],
              description: "Current agent role handling this lead",
            },
            lastCustomerReplyAt: {
              type: ["string", "null"],
              description: "ISO 8601 timestamp of last customer reply, or null if never replied",
            },
            dormancyThresholdHours: {
              type: "number",
              description: "Hours of silence before entering nurture",
            },
          },
          required: ["opportunityStage", "assignedAgent", "dormancyThresholdHours"],
        },
        execute: async (params: unknown) => {
          const handoffResult = determine(params as HandoffInput);
          return ok(handoffResult as Record<string, unknown>);
        },
      },
    },
  };
}
