import { timingSafeEqual } from "node:crypto";
import type { ActionEnvelope, RiskCategory } from "@switchboard/schemas";
import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import { transitionApproval, isExpired } from "../approval/state-machine.js";
import { applyPatch } from "../approval/patching.js";
import { canApproveWithChain } from "../approval/delegation.js";
import { evaluate } from "../engine/policy-engine.js";
import type { PolicyEngineContext } from "../engine/policy-engine.js";
import type { EvaluationContext } from "../engine/rule-evaluator.js";
import { resolveIdentity } from "../identity/spec.js";

import type { SharedContext } from "./shared-context.js";
import { buildCartridgeContext, isSmbOrg } from "./shared-context.js";
import type { ApprovalResponse } from "./lifecycle.js";
import { respondToPlanApproval } from "./plan-approval-manager.js";

export class ApprovalManager {
  private approvalResponseTimes = new Map<string, number[]>();

  constructor(private ctx: SharedContext) {}

  async respondToApproval(
    params: {
      approvalId: string;
      action: "approve" | "reject" | "patch";
      respondedBy: string;
      bindingHash: string;
      patchValue?: Record<string, unknown>;
      approvalHash?: string;
    },
    executeApproved: (envelopeId: string) => Promise<ExecuteResult>,
  ): Promise<ApprovalResponse> {
    // 1. Look up approval
    const approval = await this.ctx.storage.approvals.getById(params.approvalId);
    if (!approval) {
      throw new Error(`Approval not found: ${params.approvalId}`);
    }

    // 2. Check expired
    if (isExpired(approval.state)) {
      const expiredState = transitionApproval(approval.state, "expire");
      await this.ctx.storage.approvals.updateState(
        params.approvalId,
        expiredState,
        approval.state.version,
      );

      const envelope = await this.ctx.storage.envelopes.getById(approval.envelopeId);
      if (envelope) {
        await this.ctx.storage.envelopes.update(envelope.id, { status: "expired" });
        envelope.status = "expired";

        await this.ctx.ledger.record({
          eventType: "action.expired",
          actorType: "system",
          actorId: "orchestrator",
          entityType: "approval",
          entityId: params.approvalId,
          riskCategory: approval.request.riskCategory as RiskCategory,
          summary: `Approval expired for envelope ${approval.envelopeId}`,
          snapshot: { approvalId: params.approvalId, envelopeId: approval.envelopeId },
          envelopeId: approval.envelopeId,
        });

        return { envelope, approvalState: expiredState, executionResult: null };
      }
      throw new Error(`Envelope not found for expired approval`);
    }

    // 3. Validate binding hash for approve/patch
    if (params.action === "approve" || params.action === "patch") {
      const isSmbOrgResult = await isSmbOrg(this.ctx, approval.organizationId);
      if (isSmbOrgResult) {
        if (params.bindingHash !== approval.request.bindingHash) {
          throw new Error(
            "Binding hash mismatch: action parameters may have changed (stale approval)",
          );
        }
      } else {
        const a = Buffer.from(params.bindingHash);
        const b = Buffer.from(approval.request.bindingHash);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          throw new Error(
            "Binding hash mismatch: action parameters may have changed (stale approval)",
          );
        }
      }
    }

    // 4. Authorization check
    const isSmbOrgForAuth = await isSmbOrg(this.ctx, approval.organizationId);
    if (isSmbOrgForAuth) {
      const smbConfig = this.ctx.tierStore
        ? await this.ctx.tierStore.getSmbConfig(approval.organizationId ?? "")
        : null;
      if (smbConfig && params.respondedBy !== smbConfig.ownerId) {
        throw new Error(`Principal ${params.respondedBy} is not the organization owner`);
      }
    } else if (approval.request.approvers.length > 0) {
      const principal = await this.ctx.storage.identity.getPrincipal(params.respondedBy);
      if (!principal) {
        throw new Error(`Principal not found: ${params.respondedBy}`);
      }
      const delegations = await this.ctx.storage.identity.listDelegationRules(
        approval.organizationId ?? undefined,
      );
      const chainResult = canApproveWithChain(principal, approval.request.approvers, delegations);
      if (!chainResult.authorized) {
        throw new Error(
          `Principal ${params.respondedBy} is not authorized to respond to this approval`,
        );
      }

      if (chainResult.depth > 1) {
        await this.ctx.ledger.record({
          eventType: "delegation.chain_resolved",
          actorType: "system",
          actorId: "orchestrator",
          entityType: "approval",
          entityId: params.approvalId,
          riskCategory: approval.request.riskCategory as RiskCategory,
          summary: `Delegation chain resolved: ${chainResult.chain.join(" → ")} (depth ${chainResult.depth})`,
          snapshot: {
            chain: chainResult.chain,
            depth: chainResult.depth,
            effectiveScope: chainResult.effectiveScope,
          },
          envelopeId: approval.envelopeId,
        });
      }
    }

    // 4b. Self-approval prevention
    const envelope = await this.ctx.storage.envelopes.getById(approval.envelopeId);
    if (!envelope) {
      throw new Error(`Envelope not found: ${approval.envelopeId}`);
    }

    if (
      (params.action === "approve" || params.action === "patch") &&
      !this.ctx.selfApprovalAllowed
    ) {
      const originatingPrincipalId = envelope.proposals[0]?.parameters["_principalId"] as
        | string
        | undefined;
      if (originatingPrincipalId && params.respondedBy === originatingPrincipalId) {
        throw new Error("Self-approval is not permitted");
      }
    }

    // 4c. Approval rate limiting
    if (this.ctx.approvalRateLimit && (params.action === "approve" || params.action === "patch")) {
      const now = Date.now();
      const windowMs = this.ctx.approvalRateLimit.windowMs;
      const times = this.approvalResponseTimes.get(params.respondedBy) ?? [];
      const recentTimes = times.filter((t) => now - t < windowMs);
      if (recentTimes.length >= this.ctx.approvalRateLimit.maxApprovals) {
        throw new Error("Approval rate limit exceeded. Try again later.");
      }
      recentTimes.push(now);
      this.approvalResponseTimes.set(params.respondedBy, recentTimes);

      if (this.approvalResponseTimes.size > 1000) {
        for (const [key, ts] of this.approvalResponseTimes) {
          const filtered = ts.filter((t) => now - t < windowMs);
          if (filtered.length === 0) {
            this.approvalResponseTimes.delete(key);
          } else {
            this.approvalResponseTimes.set(key, filtered);
          }
        }
      }
    }

    // 5. Transition approval state
    const versionBeforeTransition = approval.state.version;
    const newState = transitionApproval(
      approval.state,
      params.action,
      params.respondedBy,
      params.patchValue,
      params.approvalHash,
    );
    await this.ctx.storage.approvals.updateState(
      params.approvalId,
      newState,
      versionBeforeTransition,
    );

    let executionResult: ExecuteResult | null = null;

    if (params.action === "approve") {
      if (newState.status === "approved") {
        envelope.status = "approved";
        await this.ctx.storage.envelopes.update(envelope.id, { status: "approved" });

        const isSmbForAudit = await isSmbOrg(this.ctx, approval.organizationId);
        if (isSmbForAudit && this.ctx.smbActivityLog) {
          await this.ctx.smbActivityLog.record({
            actorId: params.respondedBy,
            actorType: "user",
            actionType: "approval.approved",
            result: "approved",
            amount: null,
            summary: `Action approved by ${params.respondedBy}`,
            snapshot: { approvalId: params.approvalId },
            envelopeId: envelope.id,
            organizationId: approval.organizationId ?? "",
          });
        } else {
          await this.ctx.ledger.record({
            eventType: "action.approved",
            actorType: "user",
            actorId: params.respondedBy,
            entityType: "action",
            entityId: approval.request.actionId,
            riskCategory: approval.request.riskCategory as RiskCategory,
            summary: newState.quorum
              ? `Action approved (quorum ${newState.quorum.approvalHashes.length}/${newState.quorum.required} met) by ${params.respondedBy}`
              : `Action approved by ${params.respondedBy}`,
            snapshot: {
              approvalId: params.approvalId,
              quorum: newState.quorum ?? null,
            },
            envelopeId: envelope.id,
            traceId: envelope.traceId,
          });
        }

        if (this.ctx.executionMode === "queue" && this.ctx.onEnqueue) {
          await this.ctx.onEnqueue(envelope.id);
        } else {
          executionResult = await executeApproved(envelope.id);
        }
      } else {
        await this.ctx.ledger.record({
          eventType: "action.partially_approved",
          actorType: "user",
          actorId: params.respondedBy,
          entityType: "action",
          entityId: approval.request.actionId,
          riskCategory: approval.request.riskCategory as RiskCategory,
          summary: `Approval ${newState.quorum?.approvalHashes.length ?? 0}/${newState.quorum?.required ?? 1} received from ${params.respondedBy}`,
          snapshot: {
            approvalId: params.approvalId,
            quorum: newState.quorum ?? null,
          },
          envelopeId: envelope.id,
          traceId: envelope.traceId,
        });
      }
    } else if (params.action === "reject") {
      envelope.status = "denied";
      await this.ctx.storage.envelopes.update(envelope.id, { status: "denied" });

      await this.ctx.ledger.record({
        eventType: "action.rejected",
        actorType: "user",
        actorId: params.respondedBy,
        entityType: "action",
        entityId: approval.request.actionId,
        riskCategory: approval.request.riskCategory as RiskCategory,
        summary: `Action rejected by ${params.respondedBy}`,
        snapshot: { approvalId: params.approvalId },
        envelopeId: envelope.id,
        traceId: envelope.traceId,
      });
    } else if (params.action === "patch") {
      const originalProposal = envelope.proposals[0];
      if (originalProposal && params.patchValue) {
        const patchedParams = applyPatch(originalProposal.parameters, params.patchValue);
        originalProposal.parameters = patchedParams;

        const principalId = (originalProposal.parameters["_principalId"] as string) ?? "";
        const cartridgeId = (originalProposal.parameters["_cartridgeId"] as string) ?? "";
        const patchOrgId = (originalProposal.parameters["_organizationId"] as string) ?? null;
        const identitySpec = await this.ctx.storage.identity.getSpecByPrincipalId(principalId);
        if (identitySpec) {
          const overlays = await this.ctx.storage.identity.listOverlaysBySpecId(identitySpec.id);
          const reEvalIdentity = resolveIdentity(identitySpec, overlays, { cartridgeId });
          const cartridge = this.ctx.storage.cartridges.get(cartridgeId);
          if (cartridge) {
            let enriched: Record<string, unknown> = {};
            try {
              enriched = await cartridge.enrichContext(
                originalProposal.actionType,
                patchedParams,
                await buildCartridgeContext(this.ctx, cartridgeId, principalId, patchOrgId),
              );
            } catch (err) {
              console.warn(
                `[orchestrator] enrichContext failed during patch re-evaluation: ${err instanceof Error ? err.message : String(err)}`,
              );
            }

            let riskInput: import("@switchboard/schemas").RiskInput;
            try {
              riskInput = await cartridge.getRiskInput(originalProposal.actionType, patchedParams, {
                principalId,
                ...enriched,
              });
            } catch (err) {
              console.warn(
                `[orchestrator] getRiskInput failed during patch re-evaluation: ${err instanceof Error ? err.message : String(err)}`,
              );
              riskInput = {
                baseRisk: "medium",
                exposure: { dollarsAtRisk: 0, blastRadius: 1 },
                reversibility: "full",
                sensitivity: {
                  entityVolatile: false,
                  learningPhase: false,
                  recentlyModified: false,
                },
              };
            }
            const guardrails = cartridge.getGuardrails();
            const policies = await this.ctx.storage.policies.listActive({ cartridgeId });

            const reEvalProposal = { ...originalProposal, parameters: patchedParams };
            const reEvalContext: EvaluationContext = {
              actionType: originalProposal.actionType,
              parameters: patchedParams,
              cartridgeId,
              principalId,
              organizationId: patchOrgId,
              riskCategory: riskInput.baseRisk,
              metadata: { ...enriched, envelopeId: envelope.id },
            };
            const reEngineContext: PolicyEngineContext = {
              policies,
              guardrails,
              guardrailState: this.ctx.guardrailState,
              resolvedIdentity: reEvalIdentity,
              riskInput,
            };

            const reEvalTrace = evaluate(reEvalProposal, reEvalContext, reEngineContext);
            if (reEvalTrace.finalDecision === "deny") {
              envelope.status = "denied";
              await this.ctx.storage.envelopes.update(envelope.id, {
                status: "denied",
                proposals: envelope.proposals,
              });
              await this.ctx.ledger.record({
                eventType: "action.denied",
                actorType: "system",
                actorId: "orchestrator",
                entityType: "action",
                entityId: approval.request.actionId,
                riskCategory: reEvalTrace.computedRiskScore.category,
                summary: `Patched parameters denied by policy re-evaluation`,
                snapshot: {
                  approvalId: params.approvalId,
                  patchValue: params.patchValue,
                  reason: reEvalTrace.explanation,
                },
                envelopeId: envelope.id,
              });

              const updatedEnvelope = await this.ctx.storage.envelopes.getById(envelope.id);
              return {
                envelope: updatedEnvelope ?? envelope,
                approvalState: newState,
                executionResult: null,
              };
            }
          }
        }
      }

      envelope.status = "approved";
      await this.ctx.storage.envelopes.update(envelope.id, {
        status: "approved",
        proposals: envelope.proposals,
      });

      await this.ctx.ledger.record({
        eventType: "action.patched",
        actorType: "user",
        actorId: params.respondedBy,
        entityType: "action",
        entityId: approval.request.actionId,
        riskCategory: approval.request.riskCategory as RiskCategory,
        summary: `Action patched and approved by ${params.respondedBy}`,
        snapshot: { approvalId: params.approvalId, patchValue: params.patchValue },
        envelopeId: envelope.id,
        traceId: envelope.traceId,
      });

      if (this.ctx.executionMode === "queue" && this.ctx.onEnqueue) {
        await this.ctx.onEnqueue(envelope.id);
      } else {
        executionResult = await executeApproved(envelope.id);
      }
    }

    const updatedEnvelope = await this.ctx.storage.envelopes.getById(envelope.id);

    return {
      envelope: updatedEnvelope ?? envelope,
      approvalState: newState,
      executionResult,
    };
  }

  async respondToPlanApproval(
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
    return respondToPlanApproval(this.ctx, params, executeApproved);
  }
}
