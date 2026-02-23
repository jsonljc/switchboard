import type { ExecuteAction } from "@switchboard/schemas";
import type { RuntimeExecuteRequest, RuntimeExecuteResponse } from "./types.js";
import type { RuntimeAdapter } from "./types.js";

/**
 * Payload shape when OpenClaw invokes the switchboard_execute tool.
 * Mirrors POST /api/execute body so the same schema can be used.
 */
export interface OpenClawToolPayload {
  actorId: string;
  organizationId?: string | null;
  action: {
    actionType: string;
    parameters: Record<string, unknown>;
    sideEffect: boolean;
    magnitude?: { currencyDelta?: number; countDelta?: number };
  };
  entityRefs?: Array<{ inputRef: string; entityType: string }>;
  message?: string;
  traceId?: string;
}

/**
 * Response shape returned to the OpenClaw tool (agent-facing).
 * Includes approvalUrl for PENDING_APPROVAL so the agent can present a link or poll.
 */
export interface OpenClawToolResponse {
  outcome: RuntimeExecuteResponse["outcome"];
  envelopeId: string;
  traceId: string;
  /** Human-readable summary for the agent to relay. */
  summary?: string;
  /** When outcome is PENDING_APPROVAL: URL to approve (e.g. API or dashboard). */
  approvalUrl?: string;
  approvalId?: string;
  /** When outcome is PENDING_APPROVAL: approval request details for display. */
  approvalRequest?: RuntimeExecuteResponse["approvalRequest"];
  /** When outcome is EXECUTED. */
  executionResult?: RuntimeExecuteResponse["executionResult"];
  /** When outcome is DENIED. */
  deniedExplanation?: string;
  /** When needsClarification or notFound (mapped from 422/404). */
  error?: string;
}

/**
 * Map OpenClaw tool payload to RuntimeExecuteRequest.
 */
export function openclawPayloadToRequest(payload: OpenClawToolPayload): RuntimeExecuteRequest {
  const action: ExecuteAction = {
    actionType: payload.action.actionType,
    parameters: payload.action.parameters,
    sideEffect: payload.action.sideEffect,
    magnitude: payload.action.magnitude,
  };
  return {
    actorId: payload.actorId,
    organizationId: payload.organizationId ?? null,
    requestedAction: action,
    entityRefs: payload.entityRefs,
    message: payload.message,
    traceId: payload.traceId,
  };
}

/**
 * Map RuntimeExecuteResponse to OpenClaw tool response.
 * approvalUrlBase: base URL for the Switchboard API (e.g. https://api.example.com).
 * Approval path is /api/approvals/:id so approvalUrl = `${approvalUrlBase}/api/approvals/${approvalId}`.
 */
export function responseToOpenclawTool(
  response: RuntimeExecuteResponse,
  approvalUrlBase?: string,
): OpenClawToolResponse {
  const out: OpenClawToolResponse = {
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
    if (approvalUrlBase) {
      const base = approvalUrlBase.replace(/\/$/, "");
      out.approvalUrl = `${base}/api/approvals/${response.approvalId}`;
    }
    out.summary =
      response.approvalRequest?.summary ?? "Approval required. Use approvalUrl to approve or reject.";
  }

  if (response.outcome === "EXECUTED" && response.executionResult) {
    out.executionResult = response.executionResult;
    out.summary = response.executionResult.summary;
  }

  return out;
}

/**
 * OpenClaw adapter: uses a RuntimeAdapter (e.g. ExecutionService) to execute,
 * then maps the response to the OpenClaw tool format.
 */
export async function openclawExecute(
  payload: OpenClawToolPayload,
  adapter: RuntimeAdapter,
  options?: { approvalUrlBase?: string },
): Promise<OpenClawToolResponse> {
  const request = openclawPayloadToRequest(payload);
  const response = await adapter.execute(request);
  return responseToOpenclawTool(response, options?.approvalUrlBase);
}
