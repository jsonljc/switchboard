import type { SkillTool } from "../types.js";
import { ok } from "../tool-result.js";

interface ContactStoreSubset {
  findById(orgId: string, contactId: string): Promise<unknown>;
}

interface ActivityStoreSubset {
  listByDeployment(orgId: string, deploymentId: string, opts: { limit: number }): Promise<unknown>;
}

export function createCrmQueryTool(
  contactStore: ContactStoreSubset,
  activityStore: ActivityStoreSubset,
): SkillTool {
  return {
    id: "crm-query",
    operations: {
      "contact.get": {
        description: "Get a contact by ID. Returns name, phone, email, stage, source.",
        effectCategory: "read" as const,
        idempotent: true,
        inputSchema: {
          type: "object",
          properties: {
            contactId: { type: "string", description: "Contact UUID" },
            orgId: { type: "string", description: "Organization ID" },
          },
          required: ["contactId", "orgId"],
        },
        execute: async (params: unknown) => {
          const { contactId, orgId } = params as { contactId: string; orgId: string };
          const contact = await contactStore.findById(orgId, contactId);
          return ok(contact as Record<string, unknown>);
        },
      },
      "activity.list": {
        description: "List recent activity logs for a deployment.",
        effectCategory: "read" as const,
        idempotent: true,
        inputSchema: {
          type: "object",
          properties: {
            orgId: { type: "string" },
            deploymentId: { type: "string" },
            limit: { type: "number", description: "Max results (default 20)" },
          },
          required: ["orgId", "deploymentId"],
        },
        execute: async (params: unknown) => {
          const { orgId, deploymentId, limit } = params as {
            orgId: string;
            deploymentId: string;
            limit?: number;
          };
          const activities = await activityStore.listByDeployment(orgId, deploymentId, {
            limit: limit ?? 20,
          });
          return ok({ activities } as Record<string, unknown>);
        },
      },
    },
  };
}
