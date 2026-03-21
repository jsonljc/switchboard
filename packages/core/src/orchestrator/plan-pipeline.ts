import { randomUUID } from "node:crypto";
import type {
  ActionEnvelope,
  ActionPlan,
  ApprovalRequest,
  DecisionTrace,
  RiskCategory,
} from "@switchboard/schemas";
import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import { evaluatePlan } from "../engine/composites.js";
import { computeBindingHash, hashObject } from "../approval/binding.js";
import { createApprovalState } from "../approval/state-machine.js";
import { buildApprovalNotification } from "../notifications/notifier.js";

import type { SharedContext } from "./shared-context.js";
import type { ProposeResult } from "./lifecycle.js";
import type { ProposePipeline } from "./propose-pipeline.js";

function generateEnvelopeId(): string {
  return `env_${randomUUID()}`;
}

function generateApprovalId(): string {
  return `appr_${randomUUID()}`;
}

/**
 * Handles plan-level proposal evaluation — evaluating multiple proposals as a
 * coordinated plan with strategy (atomic, sequential, best-effort) and optional
 * single-approval consolidation.
 */
export async function proposePlan(
  pipeline: ProposePipeline,
  ctx: SharedContext,
  plan: ActionPlan,
  proposals: Array<{
    actionType: string;
    parameters: Record<string, unknown>;
    principalId: string;
    cartridgeId: string;
    organizationId?: string;
  }>,
  _executeApproved: (envelopeId: string) => Promise<ExecuteResult>,
): Promise<{
  planDecision: "allow" | "deny" | "partial";
  results: ProposeResult[];
  explanation: string;
  planApprovalRequest?: ApprovalRequest;
  planEnvelope?: ActionEnvelope;
}> {
  // Data-flow delegation
  if (plan.dataFlowSteps && plan.dataFlowSteps.length > 0 && ctx.dataFlowExecutor) {
    const firstProposal = proposals[0];
    const dataFlowResult = await ctx.dataFlowExecutor.execute(
      {
        id: plan.id,
        envelopeId: plan.envelopeId,
        strategy: plan.strategy,
        approvalMode: plan.approvalMode,
        summary: plan.summary,
        steps: plan.dataFlowSteps,
        deferredBindings: true,
      },
      {
        principalId: firstProposal?.principalId ?? "system",
        organizationId: firstProposal?.organizationId,
        traceId: `trace_${randomUUID()}`,
      },
    );

    const planDecision =
      dataFlowResult.overallOutcome === "completed"
        ? ("allow" as const)
        : dataFlowResult.overallOutcome === "partial"
          ? ("partial" as const)
          : ("deny" as const);

    return {
      planDecision,
      results: [],
      explanation: `Data-flow plan ${dataFlowResult.overallOutcome}: ${dataFlowResult.stepResults.length} steps processed`,
    };
  }

  // Evaluate each proposal independently
  const results: ProposeResult[] = [];
  const decisionTraces: DecisionTrace[] = [];

  for (const proposal of proposals) {
    const result = await pipeline.propose(proposal);
    results.push(result);
    decisionTraces.push(result.decisionTrace);
  }

  plan.proposalOrder = results.map((r) => r.envelope.proposals[0]?.id ?? "");

  const planResult = evaluatePlan(plan, decisionTraces);

  // For atomic strategy, if any denied, mark all as denied
  if (plan.strategy === "atomic" && planResult.planDecision === "deny") {
    for (const result of results) {
      if (result.envelope.status !== "denied") {
        await ctx.storage.envelopes.update(result.envelope.id, { status: "denied" });
        result.envelope.status = "denied";
      }
    }
  }

  // For sequential strategy, deny everything after first failure
  if (plan.strategy === "sequential" && planResult.planDecision !== "allow") {
    let hitFailure = false;
    for (let i = 0; i < results.length; i++) {
      const proposalId = plan.proposalOrder[i];
      if (hitFailure && proposalId) {
        const result = results[i]!;
        if (result.envelope.status !== "denied") {
          await ctx.storage.envelopes.update(result.envelope.id, { status: "denied" });
          result.envelope.status = "denied";
        }
      }
      if (results[i]?.denied) hitFailure = true;
    }
  }

  // single_approval mode: consolidate
  if (plan.approvalMode === "single_approval" && planResult.planDecision !== "deny") {
    const pendingResults = results.filter((r) => r.approvalRequest !== null);

    if (pendingResults.length > 0) {
      return consolidatePlanApproval(ctx, plan, results, pendingResults, decisionTraces, proposals);
    }
  }

  return {
    planDecision: planResult.planDecision,
    results,
    explanation: planResult.explanation,
  };
}

/**
 * Consolidate multiple pending approvals into a single plan-level approval request.
 */
async function consolidatePlanApproval(
  ctx: SharedContext,
  plan: ActionPlan,
  results: ProposeResult[],
  pendingResults: ProposeResult[],
  decisionTraces: DecisionTrace[],
  proposals: Array<{ organizationId?: string }>,
): Promise<{
  planDecision: "allow" | "deny" | "partial";
  results: ProposeResult[];
  explanation: string;
  planApprovalRequest: ApprovalRequest;
  planEnvelope: ActionEnvelope;
}> {
  const now = new Date();
  const planEnvelopeId = generateEnvelopeId();

  const planEnvelope: ActionEnvelope = {
    id: planEnvelopeId,
    version: 1,
    incomingMessage: null,
    conversationId: null,
    proposals: pendingResults.flatMap((r) => r.envelope.proposals),
    resolvedEntities: [],
    plan,
    decisions: decisionTraces,
    approvalRequests: [],
    executionResults: [],
    auditEntryIds: [],
    status: "pending_approval",
    createdAt: now,
    updatedAt: now,
    parentEnvelopeId: null,
    traceId: `trace_${randomUUID()}`,
  };

  plan.envelopeId = planEnvelopeId;

  const combinedBindingHash = computeBindingHash({
    envelopeId: planEnvelopeId,
    envelopeVersion: planEnvelope.version,
    actionId: plan.id,
    parameters: {
      proposalEnvelopeIds: results.map((r) => r.envelope.id),
    },
    decisionTraceHash: hashObject(decisionTraces),
    contextSnapshotHash: hashObject({ planId: plan.id }),
  });

  const riskPriority: RiskCategory[] = ["low", "medium", "high", "critical"];
  let highestRisk: RiskCategory = "low";
  for (const r of pendingResults) {
    const cat = r.decisionTrace.computedRiskScore.category;
    if (cat !== "none" && riskPriority.indexOf(cat) > riskPriority.indexOf(highestRisk)) {
      highestRisk = cat;
    }
  }

  const shortestExpiryMs = Math.min(
    ...pendingResults.map(
      (r) => r.approvalRequest!.expiresAt.getTime() - r.approvalRequest!.createdAt.getTime(),
    ),
  );
  const expiresAt = new Date(now.getTime() + shortestExpiryMs);

  const allApprovers = [...new Set(pendingResults.flatMap((r) => r.approvalRequest!.approvers))];

  const fallbackApprover =
    pendingResults.map((r) => r.approvalRequest!.fallbackApprover).find((f) => f !== null) ?? null;

  const summaryParts = pendingResults.map((r) => r.approvalRequest!.summary);
  const planSummary = `Plan (${pendingResults.length} actions): ${summaryParts.join("; ")}`;

  const approvalId = generateApprovalId();
  const planApprovalRequest: ApprovalRequest = {
    id: approvalId,
    actionId: plan.id,
    envelopeId: planEnvelopeId,
    conversationId: null,
    summary: planSummary,
    riskCategory: highestRisk,
    bindingHash: combinedBindingHash,
    evidenceBundle: {
      decisionTrace: decisionTraces,
      contextSnapshot: {
        proposalEnvelopeIds: results.map((r) => r.envelope.id),
      },
      identitySnapshot: {},
    },
    suggestedButtons: [
      { label: "Approve All", action: "approve" },
      { label: "Reject All", action: "reject" },
    ],
    approvers: allApprovers,
    fallbackApprover,
    status: "pending",
    respondedBy: null,
    respondedAt: null,
    patchValue: null,
    expiresAt,
    expiredBehavior: "deny" as const,
    createdAt: now,
    quorum: null,
  };

  planEnvelope.approvalRequests = [planApprovalRequest];
  await ctx.storage.envelopes.save(planEnvelope);

  const approvalState = createApprovalState(expiresAt, null);
  await ctx.storage.approvals.save({
    request: planApprovalRequest,
    state: approvalState,
    envelopeId: planEnvelopeId,
    organizationId: proposals[0]?.organizationId ?? null,
  });

  for (const result of pendingResults) {
    await ctx.storage.envelopes.update(result.envelope.id, { status: "queued" });
    result.envelope.status = "queued" as ActionEnvelope["status"];
  }

  for (const result of pendingResults) {
    result.approvalRequest = null;
  }

  if (ctx.approvalNotifier) {
    const notification = buildApprovalNotification(planApprovalRequest, decisionTraces[0]!);
    ctx.approvalNotifier.notify(notification).catch((err) => {
      console.error("Failed to send plan approval notification:", err);
    });
  }

  const planResult = evaluatePlan(plan, decisionTraces);

  return {
    planDecision: planResult.planDecision,
    results,
    explanation: planResult.explanation,
    planApprovalRequest,
    planEnvelope,
  };
}
