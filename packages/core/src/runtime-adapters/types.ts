import type { ExecuteAction } from "@switchboard/schemas";
import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type { ApprovalRequest } from "@switchboard/schemas";

/** Outcome of a single execute request (unified for runtimes e.g. OpenClaw). */
export type ExecuteOutcome = "EXECUTED" | "PENDING_APPROVAL" | "DENIED";

/** Request shape for runtime execute (API, OpenClaw, future MCP). */
export interface RuntimeExecuteRequest {
  /** Actor (principal) performing the action. */
  actorId: string;
  /** Optional organization scope. */
  organizationId?: string | null;
  /** The requested action (type, params, sideEffect, magnitude). */
  requestedAction: ExecuteAction;
  /** Optional entity refs for resolution (e.g. campaignRef -> campaign). */
  entityRefs?: Array<{ inputRef: string; entityType: string }>;
  /** Optional message/evidence for audit. */
  message?: string;
  /** Optional trace id for correlation. */
  traceId?: string;
}

/** Response shape for runtime execute. */
export interface RuntimeExecuteResponse {
  outcome: ExecuteOutcome;
  envelopeId: string;
  traceId: string;
  /** Set when outcome is PENDING_APPROVAL. */
  approvalId?: string;
  /** Approval request summary, bindingHash, etc.; set when PENDING_APPROVAL. */
  approvalRequest?: Pick<
    ApprovalRequest,
    "id" | "summary" | "riskCategory" | "bindingHash" | "expiresAt"
  >;
  /** Set when outcome is EXECUTED. */
  executionResult?: ExecuteResult;
  /** Set when outcome is DENIED. */
  deniedExplanation?: string;
  /** Set when observe mode or emergency override forced auto-approval. */
  governanceNote?: string;
}

/** Adapter interface for runtimes (OpenClaw, MCP, etc.). ExecutionService is the default implementation. */
export interface RuntimeAdapter {
  execute(request: RuntimeExecuteRequest): Promise<RuntimeExecuteResponse>;
}
