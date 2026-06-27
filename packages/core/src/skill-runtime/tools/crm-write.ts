import type { SkillTool, SkillRequestContext } from "../types.js";
import { ok, fail } from "../tool-result.js";
import { StaleVersionError } from "../../approval/state-machine.js";

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
 * Exported per-operation input-schema constants — the single source of truth for
 * each operation's LLM-facing input contract. The factory references these by
 * value (behaviour-preserving); the alex-conversation eval imports them so its
 * mock tools present the EXACT production contract (EV-5/AGENT-5 mock-tool-blind
 * gap). orgId + deploymentId are ctx-injected, never LLM input (AI-1), so they
 * never appear here.
 */
export const CRM_WRITE_STAGE_UPDATE_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    opportunityId: { type: "string", description: "Opportunity UUID" },
    stage: {
      type: "string",
      enum: ["interested", "qualified", "quoted", "booked", "showed", "won", "lost", "nurturing"],
    },
  },
  required: ["opportunityId", "stage"],
};

export const CRM_WRITE_ACTIVITY_LOG_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    eventType: {
      type: "string",
      description: "e.g. opt-out, qualification, handoff",
    },
    description: { type: "string" },
  },
  required: ["eventType", "description"],
};

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
        // P1-A: Alex is instructed to advance the pipeline stage (SKILL.md Phase 2,
        // e.g. interested -> qualified). At the default "supervised" trust a "write"
        // maps to require-approval and the in-skill GovernanceHook short-circuits
        // before execute(), so the stage silently never moves while Alex tells the
        // lead they're qualified — the cockpit/pipeline then disagree with the
        // conversation. Auto-approve at supervised (internal CRM state change; same
        // class as activity.log). guided/autonomous already auto-approve "write".
        governanceOverride: { supervised: "auto-approve" as const },
        idempotent: true,
        inputSchema: CRM_WRITE_STAGE_UPDATE_INPUT_SCHEMA,
        execute: async (params: unknown) => {
          const { opportunityId, stage } = params as {
            opportunityId: string;
            stage: string;
          };
          let result: unknown;
          try {
            result = await opportunityStore.updateStage(ctx.orgId, opportunityId, stage);
          } catch (err) {
            // A deleted or foreign opportunityId makes the store's org-scoped
            // updateMany match zero rows and throw StaleVersionError. updateStage's
            // WHERE carries no version predicate (just id + organizationId), so
            // count===0 is strictly a not-found, never a real optimistic-version
            // conflict; an in-memory store may throw the TenantMismatchError
            // subclass for the same foreign-id case. Both are the same recoverable
            // bad-input case: the LLM named an opportunity that is gone or not in
            // this conversation's scope. Returning structured guidance keeps the
            // Alex turn alive instead of letting the throw kill it. Any OTHER
            // error is a genuine store/infra failure and MUST propagate so it
            // still escalates (do not swallow a real outage).
            if (err instanceof StaleVersionError) {
              return fail("OPPORTUNITY_NOT_FOUND", "That opportunity could not be found.", {
                retryable: false,
                data: { opportunityId, failureType: "opportunity_not_found" },
                modelRemediation:
                  "The opportunity may have been removed or is not in this conversation's scope. Do not tell the lead their status changed; continue the conversation or escalate to a human.",
              });
            }
            throw err;
          }
          return ok(result as Record<string, unknown>, {
            entityState: { opportunityId, stage },
          });
        },
      },
      "activity.log": {
        description: "Log an activity event.",
        effectCategory: "write" as const,
        // P1-A: activity.log is Alex's failed-attempt fallback record (e.g. when a
        // booking dead-ends, log the attempt so the operator has a durable trail).
        // At the default "supervised" trust a "write" maps to require-approval and
        // the in-skill GovernanceHook short-circuits before execute(), so the
        // fallback record is silently swallowed too. Auto-approve at supervised so
        // the internal CRM note always lands (parity with escalate). guided/
        // autonomous already auto-approve "write", so only supervised needs it.
        governanceOverride: { supervised: "auto-approve" as const },
        idempotent: false,
        inputSchema: CRM_WRITE_ACTIVITY_LOG_INPUT_SCHEMA,
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
