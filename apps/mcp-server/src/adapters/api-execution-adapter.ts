/**
 * API-backed execution adapter for MCP server.
 * Delegates to POST /api/execute on the Switchboard API.
 */
import type {
  RuntimeAdapter,
  RuntimeExecuteRequest,
  RuntimeExecuteResponse,
} from "@switchboard/core";
import type { McpApiClient } from "../api-client.js";

export class ApiExecutionAdapter implements RuntimeAdapter {
  constructor(private client: McpApiClient) {}

  async execute(request: RuntimeExecuteRequest): Promise<RuntimeExecuteResponse> {
    const { status, data } = await this.client.post<{
      outcome: "EXECUTED" | "PENDING_APPROVAL" | "DENIED";
      envelopeId: string;
      traceId?: string;
      approvalId?: string;
      approvalRequest?: {
        id: string;
        summary: string;
        riskCategory: string;
        bindingHash: string;
        expiresAt: string;
      };
      executionResult?: {
        success: boolean;
        summary: string;
        externalRefs: Record<string, unknown>;
      };
      deniedExplanation?: string;
    }>(
      "/api/execute",
      {
        actorId: request.actorId,
        organizationId: request.organizationId ?? null,
        action: {
          actionType: request.requestedAction.actionType,
          parameters: request.requestedAction.parameters,
          sideEffect: request.requestedAction.sideEffect ?? true,
        },
        entityRefs: request.entityRefs,
        message: request.message,
        traceId: request.traceId,
      },
      this.client.idempotencyKey("mcp_exec"),
    );

    if (status >= 400) {
      return {
        outcome: "DENIED" as const,
        envelopeId: "",
        traceId: request.traceId ?? "",
        deniedExplanation: (data as { error?: string }).error ?? `API error ${status}`,
      };
    }

    return {
      outcome: data.outcome,
      envelopeId: data.envelopeId,
      traceId: data.traceId ?? request.traceId ?? "",
      approvalId: data.approvalId,
      approvalRequest: data.approvalRequest
        ? {
            id: data.approvalRequest.id,
            summary: data.approvalRequest.summary,
            riskCategory: data.approvalRequest.riskCategory,
            bindingHash: data.approvalRequest.bindingHash,
            expiresAt: new Date(data.approvalRequest.expiresAt),
          }
        : undefined,
      executionResult: data.executionResult as any,
      deniedExplanation: data.deniedExplanation,
    };
  }
}
