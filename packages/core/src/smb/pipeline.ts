import { randomUUID } from "node:crypto";
import type {
  ActionEnvelope,
  ActionProposal,
  ApprovalRequest,
  GuardrailConfig,
  DecisionTrace,
} from "@switchboard/schemas";
import type { SmbOrgConfig } from "@switchboard/schemas";
import type { StorageContext } from "../storage/interfaces.js";
import type { GuardrailState } from "../engine/policy-engine.js";
import type { GuardrailStateStore } from "../guardrail-state/store.js";
import type { ApprovalNotifier } from "../notifications/notifier.js";
import type { SmbActivityLog } from "./activity-log.js";
import type { ProposeResult } from "../orchestrator/lifecycle.js";
import { smbEvaluate } from "./evaluator.js";
import { smbCreateApprovalRequest } from "./approval.js";
import { createApprovalState } from "../approval/state-machine.js";
import { buildApprovalNotification } from "../notifications/notifier.js";
import { buildActionSummary } from "../orchestrator/summary-builder.js";

export interface SmbPipelineContext {
  storage: StorageContext;
  activityLog: SmbActivityLog;
  guardrailState: GuardrailState;
  guardrailStateStore?: GuardrailStateStore | null;
  orgConfig: SmbOrgConfig;
  approvalNotifier?: ApprovalNotifier | null;
}

async function smbEnrichAndPrepare(
  cartridge: import("@switchboard/cartridge-sdk").Cartridge,
  params: {
    actionType: string;
    parameters: Record<string, unknown>;
    principalId: string;
    organizationId?: string | null;
  },
  ctx: SmbPipelineContext,
  _now: Date,
): Promise<{ enrichedParams: Record<string, unknown>; guardrails: GuardrailConfig | null }> {
  // 2. Enrich context
  let enrichedParams = { ...params.parameters };
  try {
    const enriched = await cartridge.enrichContext(params.actionType, params.parameters, {
      principalId: params.principalId,
      organizationId: params.organizationId ?? null,
      connectionCredentials: {},
    });
    if (enriched) {
      enrichedParams = { ...enrichedParams, ...enriched };
    }
  } catch {
    // Enrichment failure is non-fatal for SMB pipeline
  }

  // 3. Get guardrails
  let guardrails: GuardrailConfig | null = null;
  try {
    guardrails = await cartridge.getGuardrails();
  } catch {
    // Guardrail fetch failure is non-fatal
  }

  // Hydrate guardrail state from external store if available
  if (ctx.guardrailStateStore && guardrails) {
    try {
      const scopeKeys: string[] = [];
      for (const rl of guardrails.rateLimits) {
        scopeKeys.push(rl.scope === "global" ? "global" : `${rl.scope}:${params.actionType}`);
      }
      const entityKeys: string[] = [];
      for (const cd of guardrails.cooldowns) {
        if (cd.actionType === params.actionType || cd.actionType === "*") {
          const entityId = (params.parameters["entityId"] as string) ?? "unknown";
          entityKeys.push(`${cd.scope}:${entityId}`);
        }
      }

      const [rateLimits, cooldowns] = await Promise.all([
        scopeKeys.length > 0
          ? ctx.guardrailStateStore.getRateLimits(scopeKeys)
          : Promise.resolve(new Map<string, { count: number; windowStart: number }>()),
        entityKeys.length > 0
          ? ctx.guardrailStateStore.getCooldowns(entityKeys)
          : Promise.resolve(new Map<string, number>()),
      ]);

      for (const [key, entry] of rateLimits) {
        ctx.guardrailState.actionCounts.set(key, entry);
      }
      for (const [key, timestamp] of cooldowns) {
        ctx.guardrailState.lastActionTimes.set(key, timestamp);
      }
    } catch {
      // Guardrail state hydration failure is non-fatal
    }
  }

  return { enrichedParams, guardrails };
}

async function smbComputeDailySpend(
  storage: StorageContext,
  params: { organizationId?: string | null; parameters: Record<string, unknown> },
  now: Date,
): Promise<number> {
  let dailySpend = 0;
  try {
    const envelopes = await storage.envelopes.list({
      status: "executed",
      organizationId: params.organizationId ?? undefined,
    });
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    for (const env of envelopes) {
      if (env.createdAt < todayStart) continue;
      for (const p of env.proposals) {
        const amount =
          typeof p.parameters["amount"] === "number"
            ? p.parameters["amount"]
            : typeof p.parameters["budgetChange"] === "number"
              ? p.parameters["budgetChange"]
              : 0;
        dailySpend += Math.abs(amount);
      }
    }
  } catch {
    // Spend lookup failure is non-fatal, defaults to 0
  }
  return dailySpend;
}

async function smbHandleDecision(
  params: {
    principalId: string;
    actionType: string;
    parameters: Record<string, unknown>;
    organizationId?: string | null;
    emergencyOverride?: boolean;
  },
  orgConfig: SmbOrgConfig,
  decisionTrace: DecisionTrace,
  envelope: ActionEnvelope,
  proposal: ActionProposal,
  enrichedParams: Record<string, unknown>,
  storage: StorageContext,
  ctx: SmbPipelineContext,
): Promise<{ approvalRequest: ApprovalRequest | null; governanceNote: string | undefined }> {
  let approvalRequest: ApprovalRequest | null = null;
  let governanceNote: string | undefined;

  const isObserveMode = orgConfig.governanceProfile === "observe";

  // Emergency override
  if (params.emergencyOverride) {
    if (params.principalId === orgConfig.ownerId) {
      envelope.status = "approved";
      governanceNote = "Emergency override approved for org owner";
    } else {
      throw new Error("Emergency override requires org owner principal");
    }
  } else if (isObserveMode) {
    envelope.status = "approved";
    governanceNote =
      "Auto-approved (observe mode): SMB governance evaluation ran but approval requirement was bypassed.";
  } else if (decisionTrace.finalDecision === "deny") {
    envelope.status = "denied";
  } else if (decisionTrace.approvalRequired !== "none") {
    // Route to single approver
    const summary = buildActionSummary(params.actionType, params.parameters, params.principalId);

    approvalRequest = smbCreateApprovalRequest({
      envelopeId: envelope.id,
      actionId: proposal.id,
      summary,
      riskCategory: decisionTrace.computedRiskScore.category,
      decisionTrace,
      orgConfig,
      contextSnapshot: enrichedParams as Record<string, unknown>,
      proposal,
    });

    envelope.approvalRequests = [approvalRequest];
    envelope.status = "pending_approval";

    // Save approval state
    const approvalState = createApprovalState(
      approvalRequest.expiresAt,
      null, // no quorum
    );
    await storage.approvals.save({
      request: approvalRequest,
      state: approvalState,
      envelopeId: envelope.id,
      organizationId: params.organizationId ?? null,
    });

    // Push notification
    if (ctx.approvalNotifier) {
      const notification = buildApprovalNotification(approvalRequest, decisionTrace);
      ctx.approvalNotifier.notify(notification).catch(() => {
        // Notification failure is non-fatal
      });
    }
  } else {
    // Auto-allowed
    envelope.status = "approved";
  }

  return { approvalRequest, governanceNote };
}

async function smbRecordActivity(
  params: {
    principalId: string;
    actionType: string;
    parameters: Record<string, unknown>;
    organizationId?: string | null;
  },
  envelope: ActionEnvelope,
  decisionTrace: DecisionTrace,
  activityLog: SmbActivityLog,
): Promise<void> {
  const spendAmount =
    typeof params.parameters["amount"] === "number"
      ? params.parameters["amount"]
      : typeof params.parameters["budgetChange"] === "number"
        ? params.parameters["budgetChange"]
        : null;

  const activityResult =
    envelope.status === "denied"
      ? ("denied" as const)
      : envelope.status === "pending_approval"
        ? ("pending_approval" as const)
        : ("allowed" as const);

  await activityLog.record({
    actorId: params.principalId,
    actorType: "user",
    actionType: params.actionType,
    result: activityResult,
    amount: spendAmount,
    summary: `Action ${params.actionType} ${envelope.status}`,
    snapshot: {
      actionType: params.actionType,
      parameters: params.parameters,
      decision: decisionTrace.finalDecision,
      riskCategory: decisionTrace.computedRiskScore.category,
    },
    envelopeId: envelope.id,
    organizationId: params.organizationId ?? "",
  });
}

/**
 * SMB propose pipeline — called from the orchestrator when tier === "smb".
 *
 * Simplified 10-step pipeline:
 * 1. Look up cartridge
 * 2. Enrich context
 * 3. Get guardrails
 * 4. Compute daily spend
 * 5. Evaluate (simplified SMB evaluator)
 * 6. Create envelope
 * 7. Handle decision (auto-approve / deny / route to single approver)
 * 8. Save envelope
 * 9. Record activity log
 * 10. Return ProposeResult
 */
export async function smbPropose(
  params: {
    actionType: string;
    parameters: Record<string, unknown>;
    principalId: string;
    organizationId?: string | null;
    cartridgeId: string;
    message?: string;
    parentEnvelopeId?: string | null;
    traceId?: string;
    emergencyOverride?: boolean;
  },
  ctx: SmbPipelineContext,
): Promise<ProposeResult> {
  const { storage, activityLog, orgConfig } = ctx;
  const envelopeId = `env_${randomUUID()}`;
  const proposalId = `prop_${randomUUID()}`;
  const traceId = params.traceId ?? `trace_${randomUUID()}`;
  const now = new Date();

  // 1. Look up cartridge
  const cartridge = await storage.cartridges.get(params.cartridgeId);
  if (!cartridge) {
    throw new Error(`Cartridge not found: ${params.cartridgeId}`);
  }

  // 2-3. Enrich context + get guardrails
  const { enrichedParams, guardrails } = await smbEnrichAndPrepare(cartridge, params, ctx, now);

  // 4. Compute daily spend
  const dailySpend = await smbComputeDailySpend(storage, params, now);

  // Create proposal
  const proposal: ActionProposal = {
    id: proposalId,
    actionType: params.actionType,
    parameters: enrichedParams,
    evidence: params.message ?? `Proposed ${params.actionType}`,
    confidence: 1.0,
    originatingMessageId: "",
  };

  // 5. Evaluate
  const decisionTrace = smbEvaluate(proposal, {
    orgConfig,
    guardrails,
    guardrailState: ctx.guardrailState,
    dailySpend,
    envelopeId,
    now,
  });

  // 6. Create envelope
  const envelope: ActionEnvelope = {
    id: envelopeId,
    version: 1,
    incomingMessage: params.message ?? null,
    conversationId: null,
    proposals: [proposal],
    resolvedEntities: [],
    plan: null,
    decisions: [decisionTrace],
    approvalRequests: [],
    executionResults: [],
    auditEntryIds: [],
    status: "proposed",
    createdAt: now,
    updatedAt: now,
    parentEnvelopeId: params.parentEnvelopeId ?? null,
    traceId,
  };

  // 7. Handle decision outcome
  const { approvalRequest, governanceNote } = await smbHandleDecision(
    params,
    orgConfig,
    decisionTrace,
    envelope,
    proposal,
    enrichedParams,
    storage,
    ctx,
  );

  // 8. Save envelope
  await storage.envelopes.save(envelope);

  // 9. Record activity log
  await smbRecordActivity(params, envelope, decisionTrace, activityLog);

  // 10. Return ProposeResult
  return {
    envelope,
    decisionTrace,
    approvalRequest,
    denied: envelope.status === "denied",
    explanation: decisionTrace.explanation,
    governanceNote,
  };
}
