import type { SkillTool } from "../types.js";

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
          return contactStore.findById(orgId, contactId);
        },
      },
      "activity.list": {
        description: "List recent activity logs for a deployment.",
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
          return activityStore.listByDeployment(orgId, deploymentId, { limit: limit ?? 20 });
        },
      },
    },
  };
}
