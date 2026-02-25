import type { LifecycleOrchestrator } from "./orchestrator/lifecycle.js";
import { inferCartridgeId } from "./orchestrator/lifecycle.js";
import type { StorageContext } from "./storage/interfaces.js";
import type {
  RuntimeExecuteRequest,
  RuntimeExecuteResponse,
  ExecuteOutcome,
  RuntimeAdapter,
} from "./runtime-adapters/types.js";

/**
 * Single facade for "propose + conditional execute".
 * Used by POST /api/execute and by runtime adapters (OpenClaw, MCP).
 */
export class ExecutionService implements RuntimeAdapter {
  private storage: StorageContext | null;

  constructor(private orchestrator: LifecycleOrchestrator, storage?: StorageContext) {
    this.storage = storage ?? null;
  }

  async execute(request: RuntimeExecuteRequest): Promise<RuntimeExecuteResponse> {
    const { requestedAction, actorId, organizationId, entityRefs, message, traceId } = request;

    const cartridgeId = inferCartridgeId(
      requestedAction.actionType,
      this.storage?.cartridges ?? undefined,
    );
    if (!cartridgeId) {
      throw new Error(
        `Cannot infer cartridgeId from actionType: ${requestedAction.actionType}`,
      );
    }

    const result = await this.orchestrator.resolveAndPropose({
      actionType: requestedAction.actionType,
      parameters: requestedAction.parameters,
      principalId: actorId,
      organizationId: organizationId ?? null,
      cartridgeId,
      entityRefs: entityRefs ?? [],
      message,
      traceId,
    });

    if ("needsClarification" in result) {
      throw new NeedsClarificationError(result.question);
    }

    if ("notFound" in result) {
      throw new NotFoundError(result.explanation);
    }

    const envelopeId = result.envelope.id;
    const outTraceId = result.envelope.traceId ?? `trace_${envelopeId}`;

    if (result.denied) {
      return {
        outcome: "DENIED" as ExecuteOutcome,
        envelopeId,
        traceId: outTraceId,
        deniedExplanation: result.explanation,
      };
    }

    if (result.approvalRequest) {
      return {
        outcome: "PENDING_APPROVAL" as ExecuteOutcome,
        envelopeId,
        traceId: outTraceId,
        approvalId: result.approvalRequest.id,
        approvalRequest: {
          id: result.approvalRequest.id,
          summary: result.approvalRequest.summary,
          riskCategory: result.approvalRequest.riskCategory,
          bindingHash: result.approvalRequest.bindingHash,
          expiresAt: result.approvalRequest.expiresAt,
        },
      };
    }

    const executionResult = await this.orchestrator.executeApproved(envelopeId);
    return {
      outcome: "EXECUTED" as ExecuteOutcome,
      envelopeId,
      traceId: outTraceId,
      executionResult,
      governanceNote: result.governanceNote,
    };
  }
}

export class NeedsClarificationError extends Error {
  constructor(public readonly question: string) {
    super(`Needs clarification: ${question}`);
    this.name = "NeedsClarificationError";
  }
}

export class NotFoundError extends Error {
  constructor(public readonly explanation: string) {
    super(explanation);
    this.name = "NotFoundError";
  }
}
