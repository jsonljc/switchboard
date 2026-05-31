import type { SkillTool, SkillRequestContext } from "../types.js";
import { ok, fail } from "../tool-result.js";
import { sanitizeContactForPrompt } from "../pii.js";

interface ContactStoreSubset {
  findById(orgId: string, contactId: string): Promise<unknown>;
}

interface ActivityStoreSubset {
  listByDeployment(orgId: string, deploymentId: string, opts: { limit: number }): Promise<unknown>;
}

/** Factory-with-context: trust-bound ids (orgId, contactId) are closed in from
 * the SkillRequestContext, never accepted from LLM tool input. */
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
        inputSchema: { type: "object", properties: {}, required: [] },
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
        inputSchema: {
          type: "object",
          properties: {
            deploymentId: { type: "string" },
            limit: { type: "number", description: "Max results (default 20)" },
          },
          required: ["deploymentId"],
        },
        execute: async (params: unknown) => {
          const { deploymentId, limit } = params as { deploymentId: string; limit?: number };
          const rows = (await activityStore.listByDeployment(ctx.orgId, deploymentId, {
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
