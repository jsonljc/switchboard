import type { SkillTool, SkillRequestContext } from "../types.js";
import { ok, fail } from "../tool-result.js";
import { sanitizeContactForPrompt } from "../pii.js";

interface ContactStoreSubset {
  findById(orgId: string, contactId: string): Promise<unknown>;
}

interface ActivityStoreSubset {
  listByDeployment(orgId: string, deploymentId: string, opts: { limit: number }): Promise<unknown>;
}

/**
 * Exported per-operation input-schema constants — the single source of truth for
 * each operation's LLM-facing input contract. The factory references these by
 * value (behaviour-preserving); the alex-conversation eval imports them so its
 * mock tools present the EXACT production contract, catching tool-contract drift
 * (EV-5/AGENT-5 "mock-tool-blind" gap). `contact.get` accepts NO input — the
 * contactId is sourced from the trusted SkillRequestContext, never from LLM tool
 * input (AI-1). `activity.list` accepts only an optional `limit`; orgId +
 * deploymentId are likewise ctx-injected, never LLM input.
 */
export const CRM_QUERY_CONTACT_GET_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {},
  required: [],
};

export const CRM_QUERY_ACTIVITY_LIST_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    limit: { type: "number", description: "Max results (default 20)" },
  },
  required: [],
};

/** Factory-with-context: trust-bound ids (orgId, contactId, deploymentId) are
 * closed in from the SkillRequestContext, never accepted from LLM tool input. */
export function createCrmQueryToolFactory(
  contactStore: ContactStoreSubset,
  activityStore: ActivityStoreSubset,
): (ctx: SkillRequestContext) => SkillTool {
  return (ctx) => ({
    id: "crm-query",
    operations: {
      "contact.get": {
        description: "Get the current contact. Returns name, stage, source.",
        effectCategory: "read" as const,
        idempotent: true,
        inputSchema: CRM_QUERY_CONTACT_GET_INPUT_SCHEMA,
        execute: async (_params: unknown) => {
          if (!ctx.contactId) {
            return fail("MISSING_CONTACT", "No contact is associated with this conversation.", {
              modelRemediation:
                "Do not call contact.get. Continue without contact details or escalate to the operator.",
              retryable: false,
            });
          }
          const contact = await contactStore.findById(ctx.orgId, ctx.contactId);
          const safe = sanitizeContactForPrompt(contact);
          if (!safe) {
            return fail("CONTACT_NOT_FOUND", "The contact record could not be read.", {
              modelRemediation: "Continue without contact details or escalate to the operator.",
              retryable: false,
            });
          }
          return ok(safe as Record<string, unknown>);
        },
      },
      "activity.list": {
        description: "List recent activity for this deployment.",
        effectCategory: "read" as const,
        idempotent: true,
        inputSchema: CRM_QUERY_ACTIVITY_LIST_INPUT_SCHEMA,
        execute: async (params: unknown) => {
          const { limit } = params as { limit?: number };
          // Trust-bound: read THIS deployment's activity only. deploymentId is
          // closed in from ctx, never from LLM tool input — an LLM-supplied
          // deploymentId would otherwise read a sibling deployment's log within
          // the org (same-org cross-deployment leak). Mirrors crm-write.ts.
          const rows = (await activityStore.listByDeployment(ctx.orgId, ctx.deploymentId, {
            limit: limit ?? 20,
          })) as Array<Record<string, unknown>>;
          // Drop the free-text `description` (may carry PII a producer logged).
          const activities = rows.map(({ description: _description, ...rest }) => rest);
          return ok({ activities } as Record<string, unknown>);
        },
      },
    },
  });
}
