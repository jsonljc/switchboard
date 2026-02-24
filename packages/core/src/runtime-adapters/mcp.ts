import type { ExecuteAction } from "@switchboard/schemas";
import type { RuntimeExecuteRequest, RuntimeExecuteResponse } from "./types.js";
import type { RuntimeAdapter } from "./types.js";

/**
 * Payload shape when an MCP client invokes a side-effect tool.
 * Mirrors the OpenClaw adapter pattern for consistency.
 */
export interface McpToolCallPayload {
  /** MCP tool name (e.g. "pause_campaign", "adjust_budget"). */
  toolName: string;
  /** Tool arguments as provided by the MCP client. */
  arguments: Record<string, unknown>;
  /** Actor context resolved from MCP auth. */
  actorId: string;
  organizationId?: string | null;
  /** Optional correlation id. */
  traceId?: string;
}

/**
 * Response shape returned to the MCP client (maps to MCP CallToolResult).
 */
export interface McpToolResponse {
  outcome: RuntimeExecuteResponse["outcome"];
  envelopeId: string;
  traceId: string;
  summary?: string;
  approvalId?: string;
  approvalRequest?: RuntimeExecuteResponse["approvalRequest"];
  executionResult?: RuntimeExecuteResponse["executionResult"];
  deniedExplanation?: string;
  error?: string;
  /** Set when observe mode or emergency override forced auto-approval. */
  governanceNote?: string;
}

/** Maps an MCP tool name to the corresponding actionType. */
const TOOL_TO_ACTION: Record<string, string> = {
  pause_campaign: "ads.campaign.pause",
  resume_campaign: "ads.campaign.resume",
  adjust_budget: "ads.budget.adjust",
  modify_targeting: "ads.targeting.modify",
};

/**
 * Map MCP tool call payload to RuntimeExecuteRequest.
 */
export function mcpToolCallToExecuteRequest(payload: McpToolCallPayload): RuntimeExecuteRequest {
  const actionType = TOOL_TO_ACTION[payload.toolName];
  if (!actionType) {
    throw new Error(`Unknown MCP side-effect tool: ${payload.toolName}`);
  }

  const action: ExecuteAction = {
    actionType,
    parameters: payload.arguments,
    sideEffect: true,
    magnitude: extractMagnitude(payload.toolName, payload.arguments),
  };

  return {
    actorId: payload.actorId,
    organizationId: payload.organizationId ?? null,
    requestedAction: action,
    message: `MCP tool call: ${payload.toolName}`,
    traceId: payload.traceId,
  };
}

/**
 * Map RuntimeExecuteResponse to MCP tool response.
 */
export function executeResponseToMcpResult(response: RuntimeExecuteResponse): McpToolResponse {
  const out: McpToolResponse = {
    outcome: response.outcome,
    envelopeId: response.envelopeId,
    traceId: response.traceId,
  };

  if (response.outcome === "DENIED") {
    out.summary = response.deniedExplanation ?? "Action was denied by policy or risk.";
    out.deniedExplanation = response.deniedExplanation;
  }

  if (response.outcome === "PENDING_APPROVAL" && response.approvalId) {
    out.approvalId = response.approvalId;
    out.approvalRequest = response.approvalRequest;
    out.summary =
      response.approvalRequest?.summary ?? "Approval required before this action can execute.";
  }

  if (response.outcome === "EXECUTED" && response.executionResult) {
    out.executionResult = response.executionResult;
    out.summary = response.executionResult.summary;
  }

  if (response.governanceNote) {
    out.governanceNote = response.governanceNote;
  }

  return out;
}

/**
 * MCP adapter: uses a RuntimeAdapter (e.g. ExecutionService) to execute,
 * then maps the response to the MCP tool format.
 */
export async function mcpExecute(
  payload: McpToolCallPayload,
  adapter: RuntimeAdapter,
): Promise<McpToolResponse> {
  const request = mcpToolCallToExecuteRequest(payload);
  const response = await adapter.execute(request);
  return executeResponseToMcpResult(response);
}

/**
 * Extract magnitude from tool arguments for risk scoring.
 */
function extractMagnitude(
  toolName: string,
  args: Record<string, unknown>,
): ExecuteAction["magnitude"] {
  if (toolName === "adjust_budget" && typeof args["newBudget"] === "number") {
    return { currencyDelta: args["newBudget"] };
  }
  return undefined;
}
