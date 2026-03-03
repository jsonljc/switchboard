import type { McpAuthContext } from "../auth.js";
import type { ReadToolDeps } from "./read.js";
import type { ExecutionService } from "@switchboard/core";
import { mcpExecute } from "@switchboard/core";
import type { McpToolResponse } from "@switchboard/core";
import type { ToolDefinition } from "./side-effect.js";

export const paymentsToolDefinitions: ToolDefinition[] = [
  {
    name: "create_invoice",
    description:
      "Create an invoice for a customer. Goes through governance pipeline. " +
      "Invoices over $1000 may require approval.",
    inputSchema: {
      type: "object",
      properties: {
        customerId: { type: "string", description: "Stripe customer ID" },
        amount: { type: "number", description: "Amount in dollars" },
        description: { type: "string", description: "Invoice description" },
      },
      required: ["customerId", "amount"],
    },
    annotations: { destructiveHint: false, openWorldHint: true },
  },
  {
    name: "create_refund",
    description: "Process a refund for a charge. Goes through governance.",
    inputSchema: {
      type: "object",
      properties: {
        chargeId: { type: "string", description: "The charge ID to refund" },
        amount: { type: "number", description: "Refund amount in dollars" },
        reason: { type: "string", description: "Reason for refund" },
      },
      required: ["chargeId", "amount"],
    },
    annotations: { destructiveHint: true, openWorldHint: true },
  },
  {
    name: "get_charge",
    description: "Look up charge details by ID.",
    inputSchema: {
      type: "object",
      properties: {
        chargeId: { type: "string", description: "The charge ID to look up" },
      },
      required: ["chargeId"],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "cancel_subscription",
    description: "Cancel a subscription. Goes through governance.",
    inputSchema: {
      type: "object",
      properties: {
        subscriptionId: { type: "string", description: "The subscription ID to cancel" },
        cancelAtPeriodEnd: {
          type: "string",
          description: "If 'true', cancel at period end instead of immediately",
        },
      },
      required: ["subscriptionId"],
    },
    annotations: { destructiveHint: true, openWorldHint: true },
  },
];

export const PAYMENTS_SIDE_EFFECT_TOOLS = new Set([
  "create_invoice",
  "create_refund",
  "cancel_subscription",
]);
export const PAYMENTS_READ_TOOLS = new Set(["get_charge"]);

/** Maps payments side-effect tool names to their actionTypes. */
export const PAYMENTS_ACTION_TYPE_MAP: Record<string, string> = {
  create_invoice: "payments.invoice.create",
  create_refund: "payments.refund.create",
  cancel_subscription: "payments.subscription.cancel",
};

export async function handlePaymentsSideEffectTool(
  toolName: string,
  args: Record<string, unknown>,
  auth: McpAuthContext,
  executionService: ExecutionService,
): Promise<McpToolResponse> {
  const actionType = PAYMENTS_ACTION_TYPE_MAP[toolName];
  if (!actionType) throw new Error(`Unknown payments side-effect tool: ${toolName}`);

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

export async function handlePaymentsReadTool(
  toolName: string,
  args: Record<string, unknown>,
  auth: McpAuthContext,
  deps: ReadToolDeps,
): Promise<unknown> {
  switch (toolName) {
    case "get_charge": {
      const result = await deps.readAdapter.query({
        cartridgeId: "payments",
        operation: "getCharge",
        parameters: { chargeId: args["chargeId"] as string },
        actorId: auth.actorId,
        organizationId: auth.organizationId,
      });
      return result;
    }
    default:
      throw new Error(`Unknown payments read tool: ${toolName}`);
  }
}
