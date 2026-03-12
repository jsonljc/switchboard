import { timingSafeEqual } from "node:crypto";
import type { ActionEnvelope, RiskCategory } from "@switchboard/schemas";
import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import { transitionApproval, isExpired } from "../approval/state-machine.js";
import { canApproveWithChain } from "../approval/delegation.js";

import type { SharedContext } from "./shared-context.js";

/**
 * Handles plan-level approval responses — approving or rejecting a consolidated
 * plan approval that governs multiple child envelopes.
 */
export async function respondToPlanApproval(
  ctx: SharedContext,
  params: {
    approvalId: string;
    action: "approve" | "reject";
    respondedBy: string;
    bindingHash: string;
  },
  executeApproved: (envelopeId: string) => Promise<ExecuteResult>,
): Promise<{
  planEnvelope: ActionEnvelope;
  executionResults: ExecuteResult[];
}> {
  const approval = await ctx.storage.approvals.getById(params.approvalId);
  if (!approval) {
    throw new Error(`Plan approval not found: ${params.approvalId}`);
  }

  if (isExpired(approval.state)) {
    return handleExpiredPlanApproval(ctx, params, approval);
  }

  if (params.action === "approve") {
    const a = Buffer.from(params.bindingHash);
    const b = Buffer.from(approval.request.bindingHash);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new Error("Binding hash mismatch: plan parameters may have changed");
    }
  }

  if (approval.request.approvers.length > 0) {
    const principal = await ctx.storage.identity.getPrincipal(params.respondedBy);
    if (!principal) {
      throw new Error(`Principal not found: ${params.respondedBy}`);
    }
    const delegations = await ctx.storage.identity.listDelegationRules(
      approval.organizationId ?? undefined,
    );
    const chainResult = canApproveWithChain(principal, approval.request.approvers, delegations);
    if (!chainResult.authorized) {
      throw new Error(
        `Principal ${params.respondedBy} is not authorized to respond to this plan approval`,
      );
    }
  }

  const planVersionBeforeTransition = approval.state.version;
  const newState = transitionApproval(
    approval.state,
    params.action === "approve" ? "approve" : "reject",
    params.respondedBy,
  );
  await ctx.storage.approvals.updateState(params.approvalId, newState, planVersionBeforeTransition);

  const planEnvelope = await ctx.storage.envelopes.getById(approval.envelopeId);
  if (!planEnvelope) {
    throw new Error(`Plan envelope not found: ${approval.envelopeId}`);
  }

  const proposalEnvelopeIds = (
    approval.request.evidenceBundle.contextSnapshot as Record<string, unknown>
  )["proposalEnvelopeIds"] as string[] | undefined;
  if (!proposalEnvelopeIds || proposalEnvelopeIds.length === 0) {
    throw new Error("No proposal envelope IDs found in plan approval");
  }

  if (params.action === "reject") {
    return rejectPlan(ctx, params, planEnvelope, proposalEnvelopeIds, approval);
  }

  return approvePlan(ctx, params, planEnvelope, proposalEnvelopeIds, approval, executeApproved);
}

async function handleExpiredPlanApproval(
  ctx: SharedContext,
  params: { approvalId: string },
  approval: Awaited<ReturnType<SharedContext["storage"]["approvals"]["getById"]>> & object,
): Promise<{ planEnvelope: ActionEnvelope; executionResults: ExecuteResult[] }> {
  const expiredState = transitionApproval(approval.state, "expire");
  await ctx.storage.approvals.updateState(params.approvalId, expiredState, approval.state.version);

  const planEnvelope = await ctx.storage.envelopes.getById(approval.envelopeId);
  if (planEnvelope) {
    await ctx.storage.envelopes.update(planEnvelope.id, { status: "expired" });
    planEnvelope.status = "expired";

    const proposalEnvelopeIds = (
      approval.request.evidenceBundle.contextSnapshot as Record<string, unknown>
    )["proposalEnvelopeIds"] as string[] | undefined;
    if (proposalEnvelopeIds) {
      for (const envId of proposalEnvelopeIds) {
        await ctx.storage.envelopes.update(envId, { status: "expired" });
      }
    }

    await ctx.ledger.record({
      eventType: "action.expired",
      actorType: "system",
      actorId: "orchestrator",
      entityType: "plan",
      entityId: params.approvalId,
      riskCategory: approval.request.riskCategory as RiskCategory,
      summary: `Plan approval expired for envelope ${approval.envelopeId}`,
      snapshot: { approvalId: params.approvalId, envelopeId: approval.envelopeId },
      envelopeId: approval.envelopeId,
    });

    return { planEnvelope, executionResults: [] };
  }
  throw new Error("Plan envelope not found for expired approval");
}

async function rejectPlan(
  ctx: SharedContext,
  params: { approvalId: string; respondedBy: string },
  planEnvelope: ActionEnvelope,
  proposalEnvelopeIds: string[],
  approval: Awaited<ReturnType<SharedContext["storage"]["approvals"]["getById"]>> & object,
): Promise<{ planEnvelope: ActionEnvelope; executionResults: ExecuteResult[] }> {
  await ctx.storage.envelopes.update(planEnvelope.id, { status: "denied" });
  planEnvelope.status = "denied";

  for (const envId of proposalEnvelopeIds) {
    await ctx.storage.envelopes.update(envId, { status: "denied" });
  }

  await ctx.ledger.record({
    eventType: "action.rejected",
    actorType: "user",
    actorId: params.respondedBy,
    entityType: "plan",
    entityId: params.approvalId,
    riskCategory: approval.request.riskCategory as RiskCategory,
    summary: `Plan rejected by ${params.respondedBy}`,
    snapshot: {
      approvalId: params.approvalId,
      envelopeId: planEnvelope.id,
      proposalEnvelopeIds,
    },
    envelopeId: planEnvelope.id,
  });

  return { planEnvelope, executionResults: [] };
}

async function approvePlan(
  ctx: SharedContext,
  params: { approvalId: string; respondedBy: string },
  planEnvelope: ActionEnvelope,
  proposalEnvelopeIds: string[],
  approval: Awaited<ReturnType<SharedContext["storage"]["approvals"]["getById"]>> & object,
  executeApproved: (envelopeId: string) => Promise<ExecuteResult>,
): Promise<{ planEnvelope: ActionEnvelope; executionResults: ExecuteResult[] }> {
  await ctx.storage.envelopes.update(planEnvelope.id, { status: "approved" });
  planEnvelope.status = "approved";

  await ctx.ledger.record({
    eventType: "action.approved",
    actorType: "user",
    actorId: params.respondedBy,
    entityType: "plan",
    entityId: params.approvalId,
    riskCategory: approval.request.riskCategory as RiskCategory,
    summary: `Plan approved by ${params.respondedBy}`,
    snapshot: {
      approvalId: params.approvalId,
      envelopeId: planEnvelope.id,
      proposalEnvelopeIds,
    },
    envelopeId: planEnvelope.id,
  });

  const executionResults: ExecuteResult[] = [];
  for (const envId of proposalEnvelopeIds) {
    await ctx.storage.envelopes.update(envId, { status: "approved" });

    try {
      const result = await executeApproved(envId);
      executionResults.push(result);

      if (planEnvelope.plan?.strategy === "atomic" && !result.success) {
        const remaining = proposalEnvelopeIds.slice(proposalEnvelopeIds.indexOf(envId) + 1);
        for (const remainingId of remaining) {
          await ctx.storage.envelopes.update(remainingId, { status: "failed" });
        }
        break;
      }
    } catch (err) {
      executionResults.push({
        success: false,
        summary: `Execution failed: ${err instanceof Error ? err.message : String(err)}`,
        externalRefs: {},
        rollbackAvailable: false,
        partialFailures: [{ step: "execute", error: String(err) }],
        durationMs: 0,
        undoRecipe: null,
      });

      if (planEnvelope.plan?.strategy === "atomic") {
        const remaining = proposalEnvelopeIds.slice(proposalEnvelopeIds.indexOf(envId) + 1);
        for (const remainingId of remaining) {
          await ctx.storage.envelopes.update(remainingId, { status: "failed" });
        }
        break;
      }
    }
  }

  const allSuccess = executionResults.every((r) => r.success);
  const planStatus = allSuccess ? "executed" : "failed";
  await ctx.storage.envelopes.update(planEnvelope.id, { status: planStatus });
  planEnvelope.status = planStatus as ActionEnvelope["status"];

  return { planEnvelope, executionResults };
}
