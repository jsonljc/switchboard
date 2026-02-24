import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type { ProposeResult, ApprovalResponse } from "./lifecycle.js";

/**
 * Narrow interface for the 4 orchestrator methods that ChatRuntime (and other
 * lightweight consumers) actually need. LifecycleOrchestrator structurally
 * satisfies this — no adapter/wrapper required.
 *
 * Use this instead of depending on the full LifecycleOrchestrator class when
 * you only need propose/execute/approve/undo.
 */
export interface RuntimeOrchestrator {
  resolveAndPropose(params: {
    actionType: string;
    parameters: Record<string, unknown>;
    principalId: string;
    cartridgeId: string;
    entityRefs: Array<{ inputRef: string; entityType: string }>;
    message?: string;
    organizationId?: string | null;
    traceId?: string;
    /** When true, bypass governance (approval, rate limits, cooldowns) while preserving full audit trail. */
    emergencyOverride?: boolean;
  }): Promise<
    | ProposeResult
    | { needsClarification: true; question: string }
    | { notFound: true; explanation: string }
  >;

  executeApproved(envelopeId: string): Promise<ExecuteResult>;

  respondToApproval(params: {
    approvalId: string;
    action: "approve" | "reject" | "patch";
    respondedBy: string;
    bindingHash: string;
    patchValue?: Record<string, unknown>;
  }): Promise<ApprovalResponse>;

  requestUndo(envelopeId: string): Promise<ProposeResult>;
}
