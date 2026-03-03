import type { McpAuthContext } from "../auth.js";
import type { ReadToolDeps } from "./read.js";
import type { ExecutionService } from "@switchboard/core";
import { mcpExecute } from "@switchboard/core";
import type { McpToolResponse } from "@switchboard/core";
import type { ToolDefinition } from "./side-effect.js";

export const crmToolDefinitions: ToolDefinition[] = [
  {
    name: "search_contacts",
    description: "Search CRM contacts by name, email, or company.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        limit: { type: "number", description: "Max results (default: 10)" },
      },
      required: ["query"],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "get_contact",
    description: "Get detailed contact information including deal history.",
    inputSchema: {
      type: "object",
      properties: {
        contactId: { type: "string", description: "The contact ID" },
      },
      required: ["contactId"],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "create_contact",
    description: "Create a new CRM contact. Goes through governance.",
    inputSchema: {
      type: "object",
      properties: {
        email: { type: "string", description: "Contact email address" },
        firstName: { type: "string", description: "First name" },
        lastName: { type: "string", description: "Last name" },
        company: { type: "string", description: "Company name" },
        phone: { type: "string", description: "Phone number" },
      },
      required: ["email"],
    },
    annotations: { destructiveHint: false, openWorldHint: true },
  },
  {
    name: "get_pipeline_status",
    description: "Get pipeline summary with deal counts and amounts per stage.",
    inputSchema: {
      type: "object",
      properties: {
        pipeline: { type: "string", description: "Pipeline name (default: 'default')" },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "get_deal",
    description: "Get details about a specific deal.",
    inputSchema: {
      type: "object",
      properties: {
        dealId: { type: "string", description: "The deal ID" },
      },
      required: ["dealId"],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "create_deal",
    description: "Create a new deal. Goes through governance.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Deal name" },
        amount: { type: "number", description: "Deal amount in dollars" },
        pipeline: { type: "string", description: "Pipeline name" },
        stage: { type: "string", description: "Deal stage" },
        contactId: { type: "string", description: "Associated contact ID" },
      },
      required: ["name"],
    },
    annotations: { destructiveHint: false, openWorldHint: true },
  },
  {
    name: "log_activity",
    description: "Log a CRM activity (note, call, email, meeting, task).",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", description: "Activity type: note, call, email, meeting, task" },
        subject: { type: "string", description: "Activity subject" },
        body: { type: "string", description: "Activity body/notes" },
        contactId: { type: "string", description: "Associated contact ID" },
        dealId: { type: "string", description: "Associated deal ID" },
      },
      required: ["type"],
    },
    annotations: { destructiveHint: false, openWorldHint: true },
  },
];

export const CRM_SIDE_EFFECT_TOOLS = new Set(["create_contact", "create_deal", "log_activity"]);
export const CRM_READ_TOOLS = new Set([
  "search_contacts",
  "get_contact",
  "get_pipeline_status",
  "get_deal",
]);

/** Maps CRM side-effect tool names to their actionTypes. */
export const CRM_ACTION_TYPE_MAP: Record<string, string> = {
  create_contact: "crm.contact.create",
  create_deal: "crm.deal.create",
  log_activity: "crm.activity.log",
};

export async function handleCrmSideEffectTool(
  toolName: string,
  args: Record<string, unknown>,
  auth: McpAuthContext,
  executionService: ExecutionService,
): Promise<McpToolResponse> {
  const actionType = CRM_ACTION_TYPE_MAP[toolName];
  if (!actionType) throw new Error(`Unknown CRM side-effect tool: ${toolName}`);

  return mcpExecute(
    {
      toolName,
      arguments: args,
      actorId: auth.actorId,
      organizationId: auth.organizationId,
    },
    executionService,
  );
}

export async function handleCrmReadTool(
  toolName: string,
  args: Record<string, unknown>,
  auth: McpAuthContext,
  deps: ReadToolDeps,
): Promise<unknown> {
  switch (toolName) {
    case "search_contacts": {
      const result = await deps.readAdapter.query({
        cartridgeId: "crm",
        operation: "searchContacts",
        parameters: { query: args["query"] as string, limit: args["limit"] as number },
        actorId: auth.actorId,
        organizationId: auth.organizationId,
      });
      return result;
    }
    case "get_contact": {
      const result = await deps.readAdapter.query({
        cartridgeId: "crm",
        operation: "getContact",
        parameters: { contactId: args["contactId"] as string },
        actorId: auth.actorId,
        organizationId: auth.organizationId,
      });
      return result;
    }
    case "get_pipeline_status": {
      const result = await deps.readAdapter.query({
        cartridgeId: "crm",
        operation: "getPipelineStatus",
        parameters: { pipeline: args["pipeline"] as string },
        actorId: auth.actorId,
        organizationId: auth.organizationId,
      });
      return result;
    }
    case "get_deal": {
      const result = await deps.readAdapter.query({
        cartridgeId: "crm",
        operation: "getDeal",
        parameters: { dealId: args["dealId"] as string },
        actorId: auth.actorId,
        organizationId: auth.organizationId,
      });
      return result;
    }
    default:
      throw new Error(`Unknown CRM read tool: ${toolName}`);
  }
}
