import type { SkillTool, SkillRequestContext } from "../types.js";
import { ok } from "../tool-result.js";

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

export type CrmWriteToolFactory = (ctx: SkillRequestContext) => SkillTool;

/**
 * Factory-with-context pattern (matches `escalate.ts`). `orgId` and
 * `deploymentId` are sourced from the trusted `SkillRequestContext` injected
 * at execution time, NEVER from LLM-controlled tool input. This closes the
 * AI-1 prompt-injection vector for crm-write.
 */
export function createCrmWriteToolFactory(
  opportunityStore: OpportunityStoreSubset,
  activityStore: ActivityStoreSubset,
): CrmWriteToolFactory {
  return (ctx: SkillRequestContext): SkillTool => ({
    id: "crm-write",
    operations: {
      "stage.update": {
        description: "Update an opportunity's pipeline stage.",
        effectCategory: "write" as const,
        idempotent: true,
        inputSchema: {
          type: "object",
          properties: {
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
          required: ["opportunityId", "stage"],
        },
        execute: async (params: unknown) => {
          const { opportunityId, stage } = params as {
            opportunityId: string;
            stage: string;
          };
          const result = await opportunityStore.updateStage(ctx.orgId, opportunityId, stage);
          return ok(result as Record<string, unknown>, {
            entityState: { opportunityId, stage },
          });
        },
      },
      "activity.log": {
        description: "Log an activity event.",
        effectCategory: "write" as const,
        idempotent: false,
        inputSchema: {
          type: "object",
          properties: {
            eventType: {
              type: "string",
              description: "e.g. opt-out, qualification, handoff",
            },
            description: { type: "string" },
          },
          required: ["eventType", "description"],
        },
        execute: async (params: unknown) => {
          const input = params as {
            eventType: string;
            description: string;
          };
          await activityStore.write({
            organizationId: ctx.orgId,
            deploymentId: ctx.deploymentId,
            eventType: input.eventType,
            description: input.description,
          });
          return ok(undefined, { entityState: { eventType: input.eventType } });
        },
      },
    },
  });
}
