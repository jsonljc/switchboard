import type { SkillTool } from "../types.js";

interface OpportunityStoreSubset {
  updateStage(
    orgId: string,
    opportunityId: string,
    stage: string,
    closedAt?: Date | null,
  ): Promise<unknown>;
}

interface ActivityStoreSubset {
  write(input: {
    organizationId: string;
    deploymentId: string;
    eventType: string;
    description: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

export function createCrmWriteTool(
  opportunityStore: OpportunityStoreSubset,
  activityStore: ActivityStoreSubset,
): SkillTool {
  return {
    id: "crm-write",
    operations: {
      "stage.update": {
        description: "Update an opportunity's pipeline stage.",
        governanceTier: "internal_write" as const,
        idempotent: true,
        inputSchema: {
          type: "object",
          properties: {
            orgId: { type: "string" },
            opportunityId: { type: "string", description: "Opportunity UUID" },
            stage: {
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
          },
          required: ["orgId", "opportunityId", "stage"],
        },
        execute: async (params: unknown) => {
          const { orgId, opportunityId, stage } = params as {
            orgId: string;
            opportunityId: string;
            stage: string;
          };
          return opportunityStore.updateStage(orgId, opportunityId, stage);
        },
      },
      "activity.log": {
        description: "Log an activity event.",
        governanceTier: "internal_write" as const,
        idempotent: false,
        inputSchema: {
          type: "object",
          properties: {
            organizationId: { type: "string" },
            deploymentId: { type: "string" },
            eventType: {
              type: "string",
              description: "e.g. opt-out, qualification, handoff",
            },
            description: { type: "string" },
          },
          required: ["organizationId", "deploymentId", "eventType", "description"],
        },
        execute: async (params: unknown) => {
          const input = params as {
            organizationId: string;
            deploymentId: string;
            eventType: string;
            description: string;
          };
          await activityStore.write(input);
        },
      },
    },
  };
}
