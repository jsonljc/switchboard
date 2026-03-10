import type { LifecycleOrchestrator } from "@switchboard/core";
import type { ExecuteResult } from "@switchboard/cartridge-sdk";

export interface GovernedSystemActionRequest {
  orchestrator: LifecycleOrchestrator;
  actionType: string;
  cartridgeId: string;
  organizationId: string;
  parameters: Record<string, unknown>;
  message?: string;
  idempotencyKey?: string;
}

export type GovernedSystemActionResult =
  | {
      outcome: "executed";
      executionResult: ExecuteResult;
      envelopeId: string;
    }
  | {
      outcome: "denied" | "pending_approval";
      explanation: string;
      envelopeId: string;
    };

export async function executeGovernedSystemAction(
  request: GovernedSystemActionRequest,
): Promise<GovernedSystemActionResult> {
  const proposeResult = await request.orchestrator.propose({
    actionType: request.actionType,
    parameters: request.parameters,
    principalId: "system",
    organizationId: request.organizationId,
    cartridgeId: request.cartridgeId,
    message: request.message,
    idempotencyKey: request.idempotencyKey,
  });

  if (proposeResult.denied) {
    return {
      outcome: "denied",
      explanation: proposeResult.explanation,
      envelopeId: proposeResult.envelope.id,
    };
  }

  if (proposeResult.approvalRequest) {
    return {
      outcome: "pending_approval",
      explanation: proposeResult.approvalRequest.summary,
      envelopeId: proposeResult.envelope.id,
    };
  }

  const executionResult = await request.orchestrator.executeApproved(proposeResult.envelope.id);
  return {
    outcome: "executed",
    executionResult,
    envelopeId: proposeResult.envelope.id,
  };
}
