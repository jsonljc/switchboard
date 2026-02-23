/**
 * Adapter that implements the orchestrator interface by calling the Switchboard HTTP API.
 * Use when SWITCHBOARD_API_URL is set so Chat uses a single choke point (the API) for propose/execute/approvals.
 */
import type {
  LifecycleOrchestrator,
  ProposeResult,
  ApprovalResponse,
} from "@switchboard/core";
import type { ActionEnvelope, DecisionTrace, ApprovalRequest } from "@switchboard/schemas";
import type { ExecuteResult } from "@switchboard/cartridge-sdk";

const RISK_CATEGORIES = ["none", "low", "medium", "high", "critical"] as const;
function riskCategory(c: string): (typeof RISK_CATEGORIES)[number] {
  return RISK_CATEGORIES.includes(c as (typeof RISK_CATEGORIES)[number]) ? (c as (typeof RISK_CATEGORIES)[number]) : "low";
}

function minimalComputedRiskScore(category: string): DecisionTrace["computedRiskScore"] {
  return {
    rawScore: 0,
    category: riskCategory(category),
    factors: [],
  };
}

function minimalEnvelope(
  id: string,
  status: ActionEnvelope["status"],
  traceId: string,
  riskCategoryVal = "low",
): ActionEnvelope {
  return {
    id,
    version: 1,
    incomingMessage: null,
    conversationId: null,
    proposals: [],
    resolvedEntities: [],
    plan: null,
    decisions: [
      {
        actionId: id,
        envelopeId: id,
        checks: [],
        computedRiskScore: minimalComputedRiskScore(riskCategoryVal),
        finalDecision: "allow",
        approvalRequired: "none",
        explanation: "",
        evaluatedAt: new Date(),
      },
    ],
    approvalRequests: [],
    executionResults: [],
    auditEntryIds: [id],
    status,
    createdAt: new Date(),
    updatedAt: new Date(),
    parentEnvelopeId: null,
    traceId,
  };
}

function minimalDecisionTrace(
  envelopeId: string,
  riskCategoryVal: string,
  explanation: string,
): DecisionTrace {
  return {
    actionId: envelopeId,
    envelopeId,
    checks: [],
    computedRiskScore: minimalComputedRiskScore(riskCategoryVal),
    finalDecision: "allow",
    approvalRequired: "none",
    explanation,
    evaluatedAt: new Date(),
  };
}

function minimalApprovalRequest(
  id: string,
  envelopeId: string,
  summary: string,
  riskCategory: string,
  bindingHash: string,
  expiresAt: string,
): ApprovalRequest {
  return {
    id,
    actionId: envelopeId,
    envelopeId,
    conversationId: null,
    summary,
    riskCategory,
    bindingHash,
    evidenceBundle: { decisionTrace: {}, contextSnapshot: {}, identitySnapshot: {} },
    suggestedButtons: [],
    approvers: [],
    fallbackApprover: null,
    status: "pending",
    respondedBy: null,
    respondedAt: null,
    patchValue: null,
    expiresAt: new Date(expiresAt),
    expiredBehavior: "deny",
    createdAt: new Date(),
  };
}

export interface ApiOrchestratorConfig {
  baseUrl: string;
  apiKey?: string;
}

/** Cached execution result when POST /api/execute returns EXECUTED (so executeApproved can return it without a second call). */
const executedCache = new Map<string, ExecuteResult>();

/**
 * LifecycleOrchestrator-compatible adapter that delegates to Switchboard HTTP API.
 * Single choke point: all propose/execute/approval/undo go through the API.
 */
export class ApiOrchestratorAdapter implements Pick<
  LifecycleOrchestrator,
  "resolveAndPropose" | "executeApproved" | "respondToApproval" | "requestUndo"
> {
  constructor(private config: ApiOrchestratorConfig) {}

  private base(): string {
    return this.config.baseUrl.replace(/\/$/, "");
  }

  private headers(idempotencyKey?: string): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (idempotencyKey) h["Idempotency-Key"] = idempotencyKey;
    if (this.config.apiKey) h["Authorization"] = `Bearer ${this.config.apiKey}`;
    return h;
  }

  async resolveAndPropose(params: Parameters<LifecycleOrchestrator["resolveAndPropose"]>[0]): Promise<
    | ProposeResult
    | { needsClarification: true; question: string }
    | { notFound: true; explanation: string }
  > {
    const idempotencyKey = `chat_${params.traceId ?? crypto.randomUUID()}`;
    const body = {
      actorId: params.principalId,
      organizationId: params.organizationId ?? null,
      action: {
        actionType: params.actionType,
        parameters: params.parameters,
        sideEffect: true,
      },
      entityRefs: params.entityRefs,
      message: params.message,
      traceId: params.traceId,
    };

    const res = await fetch(`${this.base()}/api/execute`, {
      method: "POST",
      headers: this.headers(idempotencyKey),
      body: JSON.stringify(body),
    });

    if (res.status === 422) {
      const data = (await res.json()) as { question?: string };
      return { needsClarification: true, question: data.question ?? "Clarification needed." };
    }
    if (res.status === 404) {
      const data = (await res.json()) as { explanation?: string };
      return { notFound: true, explanation: data.explanation ?? "Not found." };
    }
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? `API ${res.status}`);
    }

    const data = (await res.json()) as {
      outcome: "EXECUTED" | "PENDING_APPROVAL" | "DENIED";
      envelopeId: string;
      traceId: string;
      approvalId?: string;
      approvalRequest?: { id: string; summary: string; riskCategory: string; bindingHash: string; expiresAt: string };
      executionResult?: ExecuteResult;
      deniedExplanation?: string;
    };

    const envelopeId = data.envelopeId;
    const traceId = data.traceId ?? `trace_${envelopeId}`;

    if (data.outcome === "DENIED") {
      return {
        envelope: minimalEnvelope(envelopeId, "denied", traceId),
        decisionTrace: minimalDecisionTrace(envelopeId, "high", data.deniedExplanation ?? "Denied"),
        approvalRequest: null,
        denied: true,
        explanation: data.deniedExplanation ?? "Action denied.",
      };
    }

    if (data.outcome === "PENDING_APPROVAL" && data.approvalRequest) {
      const ar = data.approvalRequest;
      const approvalReq = minimalApprovalRequest(
        data.approvalId ?? ar.id,
        envelopeId,
        ar.summary,
        ar.riskCategory,
        ar.bindingHash,
        ar.expiresAt,
      );
      return {
        envelope: minimalEnvelope(envelopeId, "pending_approval", traceId, ar.riskCategory),
        decisionTrace: minimalDecisionTrace(envelopeId, ar.riskCategory, ar.summary),
        approvalRequest: approvalReq,
        denied: false,
        explanation: "",
      };
    }

    // EXECUTED
    if (data.executionResult) {
      executedCache.set(envelopeId, data.executionResult);
    }
    return {
      envelope: minimalEnvelope(envelopeId, "approved", traceId),
      decisionTrace: minimalDecisionTrace(envelopeId, "low", "Auto-approved"),
      approvalRequest: null,
      denied: false,
      explanation: "",
    };
  }

  async executeApproved(envelopeId: string): Promise<ExecuteResult> {
    const cached = executedCache.get(envelopeId);
    if (cached) {
      executedCache.delete(envelopeId);
      return cached;
    }
    const res = await fetch(`${this.base()}/api/actions/${envelopeId}/execute`, {
      method: "POST",
      headers: this.headers(),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? `Execute failed: ${res.status}`);
    }
    const data = (await res.json()) as { result: ExecuteResult };
    return data.result;
  }

  async respondToApproval(params: {
    approvalId: string;
    action: "approve" | "reject" | "patch";
    respondedBy: string;
    bindingHash: string;
    patchValue?: Record<string, unknown>;
  }): Promise<ApprovalResponse> {
    const res = await fetch(`${this.base()}/api/approvals/${params.approvalId}/respond`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        action: params.action,
        respondedBy: params.respondedBy,
        bindingHash: params.bindingHash,
        patchValue: params.patchValue,
      }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? `Respond failed: ${res.status}`);
    }
    const data = (await res.json()) as {
      envelope: ActionEnvelope;
      approvalState: ApprovalResponse["approvalState"];
      executionResult: ExecuteResult | null;
    };
    return {
      envelope: data.envelope,
      approvalState: data.approvalState,
      executionResult: data.executionResult,
    };
  }

  async requestUndo(envelopeId: string): Promise<ProposeResult> {
    const res = await fetch(`${this.base()}/api/actions/${envelopeId}/undo`, {
      method: "POST",
      headers: this.headers(),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? `Undo failed: ${res.status}`);
    }
    const data = (await res.json()) as {
      envelope: ActionEnvelope;
      decisionTrace: DecisionTrace;
      approvalRequest: ApprovalRequest | null;
      denied: boolean;
      explanation: string;
    };
    return {
      envelope: data.envelope,
      decisionTrace: data.decisionTrace,
      approvalRequest: data.approvalRequest,
      denied: data.denied,
      explanation: data.explanation,
    };
  }
}
