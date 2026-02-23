import type { ExecutionService } from "@switchboard/core";
import { mcpExecute } from "@switchboard/core";
import type { McpToolResponse } from "@switchboard/core";
import {
  PauseCampaignInputSchema,
  ResumeCampaignInputSchema,
  AdjustBudgetInputSchema,
  ModifyTargetingInputSchema,
} from "@switchboard/schemas";
import type { McpAuthContext } from "../auth.js";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const sideEffectToolDefinitions: ToolDefinition[] = [
  {
    name: "pause_campaign",
    description:
      "Pause an active ad campaign. Goes through the full governance pipeline " +
      "(risk scoring, policy evaluation, approval routing). Returns EXECUTED, " +
      "PENDING_APPROVAL, or DENIED.",
    inputSchema: {
      type: "object",
      properties: {
        campaignId: { type: "string", description: "The campaign ID to pause" },
        reason: { type: "string", description: "Optional reason for pausing" },
      },
      required: ["campaignId"],
    },
  },
  {
    name: "resume_campaign",
    description:
      "Resume a paused ad campaign. Goes through the governance pipeline.",
    inputSchema: {
      type: "object",
      properties: {
        campaignId: { type: "string", description: "The campaign ID to resume" },
      },
      required: ["campaignId"],
    },
  },
  {
    name: "adjust_budget",
    description:
      "Adjust the daily budget of an ad campaign. High-risk action — large " +
      "budget increases will require approval. Goes through the full governance pipeline.",
    inputSchema: {
      type: "object",
      properties: {
        campaignId: { type: "string", description: "The campaign ID" },
        newBudget: { type: "number", description: "New daily budget in dollars" },
        currency: { type: "string", description: "Currency code (default: USD)" },
      },
      required: ["campaignId", "newBudget"],
    },
  },
  {
    name: "modify_targeting",
    description:
      "Modify targeting parameters for an ad set. Irreversible action — " +
      "requires strict governance. Goes through the full governance pipeline.",
    inputSchema: {
      type: "object",
      properties: {
        adSetId: { type: "string", description: "The ad set ID to modify" },
        targeting: {
          type: "object",
          description: "New targeting parameters",
          additionalProperties: true,
        },
      },
      required: ["adSetId", "targeting"],
    },
  },
];

const SCHEMAS = {
  pause_campaign: PauseCampaignInputSchema,
  resume_campaign: ResumeCampaignInputSchema,
  adjust_budget: AdjustBudgetInputSchema,
  modify_targeting: ModifyTargetingInputSchema,
} as const;

export async function handleSideEffectTool(
  toolName: string,
  args: Record<string, unknown>,
  auth: McpAuthContext,
  executionService: ExecutionService,
): Promise<McpToolResponse> {
  // Validate input
  const schema = SCHEMAS[toolName as keyof typeof SCHEMAS];
  if (!schema) {
    throw new Error(`Unknown side-effect tool: ${toolName}`);
  }

  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    throw new Error(`Invalid input for ${toolName}: ${parsed.error.message}`);
  }

  return mcpExecute(
    {
      toolName,
      arguments: parsed.data as Record<string, unknown>,
      actorId: auth.actorId,
      organizationId: auth.organizationId,
    },
    executionService,
  );
}
