import { randomUUID } from "node:crypto";
import type {
  ActionProposal,
  ActionEnvelope,
  ApprovalRequest,
  ExecutionResult,
  RiskCategory,
} from "@switchboard/schemas";
import type { WorkUnit } from "@switchboard/core/platform";
import type { StorageContext, LifecycleOrchestrator } from "@switchboard/core";
import {
  computeBindingHash,
  hashObject,
  routeApproval,
  createApprovalState,
  resolveIdentity,
} from "@switchboard/core";

interface CreateApprovalEnvelopeParams {
  workUnit: WorkUnit;
  body: { actionType: string; principalId: string; cartridgeId?: string };
  storageContext: StorageContext;
  orchestrator: LifecycleOrchestrator;
}

interface CreateExecutedEnvelopeParams {
  workUnit: WorkUnit;
  result: {
    outcome: string;
    summary: string;
    outputs: Record<string, unknown>;
    durationMs: number;
  };
  body?: { actionType: string; principalId: string; cartridgeId?: string };
  storageContext: StorageContext;
}

/**
 * Creates a synthetic approval envelope for backward compatibility with GET/approve/execute endpoints.
 * Persists the envelope, approval state, and audit entry.
 */
export async function createApprovalEnvelope(
  params: CreateApprovalEnvelopeParams,
): Promise<{ envelopeId: string; approvalRequest: { id: string; bindingHash: string } }> {
  const { workUnit, body, storageContext, orchestrator } = params;

  // Build a synthetic envelope so downstream GET/approve/execute endpoints work
  const proposalId = `prop_${workUnit.id}`;
  const now = new Date();
  const proposal: ActionProposal = {
    id: proposalId,
    actionType: workUnit.intent,
    parameters: {
      ...workUnit.parameters,
      _principalId: workUnit.actor.id,
      _cartridgeId: body.cartridgeId ?? workUnit.intent.split(".")[0],
      _organizationId: workUnit.organizationId,
    },
    evidence: `Proposed ${workUnit.intent}`,
    confidence: 1.0,
    originatingMessageId: "",
  };

  // Resolve identity + routing to build the approval request
  const identitySpec = await storageContext.identity.getSpecByPrincipalId(workUnit.actor.id);
  if (!identitySpec) {
    throw new Error("Identity spec not found for actor");
  }
  const overlays = await storageContext.identity.listOverlaysBySpecId(identitySpec.id);
  const cartridgeId = body.cartridgeId ?? workUnit.intent.split(".")[0] ?? workUnit.intent;
  const resolvedId = resolveIdentity(identitySpec, overlays, { cartridgeId });

  // Get risk category from the cartridge
  const cartridge = storageContext.cartridges.get(cartridgeId);
  let riskCategory: RiskCategory = "medium";
  if (cartridge) {
    try {
      const riskInput = await cartridge.getRiskInput(workUnit.intent, workUnit.parameters, {});
      riskCategory = riskInput.baseRisk;
    } catch {
      // Fall through with default
    }
  }

  const routing = routeApproval(riskCategory, resolvedId, orchestrator.routingConfig);

  const envelopeId = workUnit.id;
  const bindingHash = computeBindingHash({
    envelopeId,
    envelopeVersion: 1,
    actionId: proposalId,
    parameters: workUnit.parameters,
    decisionTraceHash: hashObject({ intent: workUnit.intent }),
    contextSnapshotHash: hashObject({ actor: workUnit.actor.id }),
  });

  const approvalId = `appr_${randomUUID()}`;
  const expiresAt = new Date(now.getTime() + routing.expiresInMs);

  const approvalRequest: ApprovalRequest = {
    id: approvalId,
    actionId: proposalId,
    envelopeId,
    conversationId: null,
    summary: `${workUnit.intent} (requested by ${workUnit.actor.id})`,
    riskCategory,
    bindingHash,
    evidenceBundle: {
      decisionTrace: null,
      contextSnapshot: {},
      identitySnapshot: {},
    },
    suggestedButtons: [
      { label: "Approve", action: "approve" },
      { label: "Reject", action: "reject" },
    ],
    approvers: routing.approvers,
    fallbackApprover: routing.fallbackApprover,
    status: "pending",
    respondedBy: null,
    respondedAt: null,
    patchValue: null,
    expiresAt,
    expiredBehavior: routing.expiredBehavior,
    createdAt: now,
    quorum: null,
  };

  const envelope: ActionEnvelope = {
    id: envelopeId,
    version: 1,
    incomingMessage: null,
    conversationId: null,
    proposals: [proposal],
    resolvedEntities: [],
    plan: null,
    decisions: [],
    approvalRequests: [approvalRequest],
    executionResults: [],
    auditEntryIds: [],
    status: "pending_approval",
    createdAt: now,
    updatedAt: now,
    parentEnvelopeId: null,
    traceId: workUnit.traceId,
  };

  await storageContext.envelopes.save(envelope);
  const approvalState = createApprovalState(expiresAt);
  await storageContext.approvals.save({
    request: approvalRequest,
    state: approvalState,
    envelopeId,
    organizationId: workUnit.organizationId,
  });

  // Record audit entry
  // Note: We can't import AuditLedger type directly since it's app-level,
  // but the storageContext provides access via the app instance
  // This will be called from the route handler which has access to app.auditLedger

  return { envelopeId, approvalRequest: { id: approvalId, bindingHash } };
}

/**
 * Creates a synthetic executed envelope for backward compatibility with GET endpoints.
 * Persists the envelope and audit entry.
 */
export async function createExecutedEnvelope(
  params: CreateExecutedEnvelopeParams,
): Promise<string> {
  const { workUnit, result, storageContext } = params;

  const proposal: ActionProposal = {
    id: `prop_${workUnit.id}`,
    actionType: workUnit.intent,
    parameters: {
      ...workUnit.parameters,
      _principalId: workUnit.actor.id,
      _organizationId: workUnit.organizationId,
    },
    evidence: result.summary,
    confidence: 1.0,
    originatingMessageId: "",
  };

  const executionResult: ExecutionResult = {
    actionId: proposal.id,
    envelopeId: workUnit.id,
    success: true,
    summary: result.summary,
    externalRefs: (result.outputs.externalRefs as Record<string, string>) || {},
    rollbackAvailable: false,
    partialFailures: [],
    durationMs: result.durationMs,
    undoRecipe: null,
    executedAt: new Date(),
  };

  const now = new Date();
  const envelope: ActionEnvelope = {
    id: workUnit.id,
    version: 1,
    incomingMessage: null,
    conversationId: null,
    proposals: [proposal],
    resolvedEntities: [],
    plan: null,
    decisions: [],
    approvalRequests: [],
    executionResults: [executionResult],
    auditEntryIds: [],
    status: "executed",
    createdAt: now,
    updatedAt: now,
    parentEnvelopeId: null,
    traceId: workUnit.traceId,
  };

  await storageContext.envelopes.save(envelope);

  return workUnit.id;
}

/**
 * Records an audit entry for action proposals.
 * Extracted to a separate function since audit ledger is app-level and can't be passed directly.
 */
export async function recordProposalAudit(params: {
  auditLedger: Pick<import("@switchboard/core").AuditLedger, "record">;
  eventType: "action.proposed";
  workUnit: WorkUnit;
  proposalId: string;
  riskCategory: RiskCategory;
  approvalRequired?: boolean;
}): Promise<void> {
  const { auditLedger, eventType, workUnit, proposalId, riskCategory, approvalRequired } = params;

  await auditLedger.record({
    eventType,
    actorType: "user",
    actorId: workUnit.actor.id,
    entityType: "action",
    entityId: proposalId,
    riskCategory,
    summary: approvalRequired
      ? `Action ${workUnit.intent} pending_approval`
      : `Action ${workUnit.intent} executed`,
    snapshot: approvalRequired
      ? {
          actionType: workUnit.intent,
          parameters: workUnit.parameters,
          approvalRequired: true,
        }
      : {
          actionType: workUnit.intent,
          parameters: workUnit.parameters,
          decision: "allow",
        },
    envelopeId: workUnit.id,
    organizationId: workUnit.organizationId,
    traceId: workUnit.traceId,
  });
}
