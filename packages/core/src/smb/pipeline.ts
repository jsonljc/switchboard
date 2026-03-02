import { randomUUID } from "node:crypto";
import type {
  ActionEnvelope,
  ActionProposal,
  DecisionTrace,
  ApprovalRequest,
  GuardrailConfig,
} from "@switchboard/schemas";
import type { SmbOrgConfig } from "@switchboard/schemas";
import type { StorageContext } from "../storage/interfaces.js";
import type { GuardrailState } from "../engine/policy-engine.js";
import type { GuardrailStateStore } from "../guardrail-state/store.js";
import type { ApprovalNotifier } from "../notifications/notifier.js";
import type { SmbActivityLog } from "./activity-log.js";
import type { ProposeResult } from "../orchestrator/lifecycle.js";
import { smbEvaluate } from "./evaluator.js";
import { smbRouteApproval, smbCreateApprovalRequest } from "./approval.js";
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

  // 2. Enrich context (same as enterprise, with try/catch fallback)
  let enrichedParams = { ...params.parameters };
  try {
    const enriched = await cartridge.enrichContext(params.actionType, params.parameters);
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
  if (ctx.guardrailStateStore) {
    try {
      const stored = await ctx.guardrailStateStore.load(params.cartridgeId);
      if (stored) {
        for (const [key, value] of stored.actionCounts.entries()) {
          ctx.guardrailState.actionCounts.set(key, value);
        }
        for (const [key, value] of stored.lastActionTimes.entries()) {
          ctx.guardrailState.lastActionTimes.set(key, value);
        }
      }
    } catch {
      // Guardrail state hydration failure is non-fatal
    }
  }

  // 4. Compute daily spend — query today's executed envelopes
  let dailySpend = 0;
  try {
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const envelopes = await storage.envelopes.list({
      status: "executed",
      after: todayStart,
    });
    for (const env of envelopes) {
      for (const p of env.proposals) {
        const amount = typeof p.parameters["amount"] === "number"
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

  // Create proposal
  const proposal: ActionProposal = {
    id: proposalId,
    actionType: params.actionType,
    parameters: enrichedParams,
    source: "user",
    interpreterName: null,
    confidence: 1,
    createdAt: now,
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
  let approvalRequest: ApprovalRequest | null = null;
  let governanceNote: string | undefined;

  const isObserveMode = orgConfig.governanceProfile === "observe";

  if (isObserveMode) {
    envelope.status = "approved";
    governanceNote = "Auto-approved (observe mode): SMB governance evaluation ran but approval requirement was bypassed.";
  } else if (decisionTrace.finalDecision === "deny") {
    envelope.status = "denied";
  } else if (decisionTrace.approvalRequired !== "none") {
    // Route to single approver
    const routing = smbRouteApproval(orgConfig, true);

    const summary = buildActionSummary(
      params.actionType,
      params.parameters,
      params.principalId,
    );

    approvalRequest = smbCreateApprovalRequest({
      envelopeId: envelope.id,
      actionId: proposal.id,
      summary,
      riskCategory: decisionTrace.computedRiskScore.category,
      decisionTrace,
      orgConfig,
      contextSnapshot: enrichedParams as Record<string, unknown>,
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

  // 8. Save envelope
  await storage.envelopes.save(envelope);

  // Extract spend amount for activity log
  const spendAmount = typeof params.parameters["amount"] === "number"
    ? params.parameters["amount"]
    : typeof params.parameters["budgetChange"] === "number"
      ? params.parameters["budgetChange"]
      : null;

  // 9. Record activity log
  const activityResult = envelope.status === "denied" ? "denied" as const
    : envelope.status === "pending_approval" ? "pending_approval" as const
    : "allowed" as const;

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
