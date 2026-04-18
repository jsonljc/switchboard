/* eslint-disable max-lines */
import { randomUUID } from "node:crypto";
import type {
  ActionEnvelope,
  ActionPlan,
  ActionProposal,
  ApprovalRequest,
} from "@switchboard/schemas";
import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type { PolicyEngineContext } from "../engine/policy-engine.js";
import type { SimulationResult } from "../engine/simulator.js";
import type { EvaluationContext } from "../engine/rule-evaluator.js";
import type { EntityResolver } from "../engine/resolver.js";

import { evaluate, simulate as policySimulate } from "../engine/policy-engine.js";
import { type ResolvedIdentity, resolveIdentity } from "../identity/spec.js";
import { routeApproval } from "../approval/router.js";
import { createApprovalState } from "../approval/state-machine.js";
import { computeBindingHash, hashObject } from "../approval/binding.js";
import {
  resolveEntities,
  buildClarificationQuestion,
  buildNotFoundExplanation,
} from "../engine/resolver.js";
import { profileToPosture, checkActionTypeRestriction } from "../governance/profile.js";
import { DEFAULT_POLICY_CACHE_TTL_MS } from "../policy-cache.js";
import { buildApprovalNotification } from "../notifications/notifier.js";
import { buildActionSummary } from "./summary-builder.js";
import { getTracer } from "../telemetry/tracing.js";
import { getMetrics } from "../telemetry/metrics.js";

import type { SharedContext } from "./shared-context.js";
import { buildCartridgeContext } from "./shared-context.js";
import type { ProposeResult } from "./lifecycle.js";
import {
  hydrateGuardrailState,
  extractQuorumFromPolicies,
  buildSpendLookup,
  buildCompositeContext,
  clearProposeCaches,
  resolveEffectiveIdentity,
  enrichAndGetRiskInput,
} from "./propose-helpers.js";
import { proposePlan } from "./plan-pipeline.js";

function generateEnvelopeId(): string {
  return `env_${randomUUID()}`;
}

function generateApprovalId(): string {
  return `appr_${randomUUID()}`;
}

export class ProposePipeline {
  constructor(private ctx: SharedContext) {}

  async propose(params: {
    actionType: string;
    parameters: Record<string, unknown>;
    principalId: string;
    organizationId?: string | null;
    cartridgeId: string;
    message?: string;
    parentEnvelopeId?: string | null;
    traceId?: string;
    emergencyOverride?: boolean;
    idempotencyKey?: string;
  }): Promise<ProposeResult> {
    // Idempotency check: if a key is provided and we have a guard, check for duplicates
    if (params.idempotencyKey && this.ctx.idempotencyGuard) {
      const { isDuplicate, cachedResponse } = await this.ctx.idempotencyGuard.checkDuplicate(
        params.principalId,
        params.actionType,
        params.parameters,
      );
      if (isDuplicate && cachedResponse) {
        return cachedResponse as ProposeResult;
      }
    }

    const span = getTracer().startSpan("orchestrator.propose", {
      "action.type": params.actionType,
      "principal.id": params.principalId,
      "cartridge.id": params.cartridgeId,
    });
    const proposeStart = Date.now();
    try {
      const result = await this.proposeInner(params, span, proposeStart);

      // Cache result for idempotency
      if (params.idempotencyKey && this.ctx.idempotencyGuard) {
        await this.ctx.idempotencyGuard.recordResponse(
          params.principalId,
          params.actionType,
          params.parameters,
          result,
        );
      }

      return result;
    } catch (err) {
      span.setStatus("ERROR", err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      span.end();
    }
  }

  private async proposeInner(
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
    span: ReturnType<ReturnType<typeof getTracer>["startSpan"]>,
    proposeStart: number,
  ): Promise<ProposeResult> {
    const { effectiveIdentity } = await resolveEffectiveIdentity(
      this.ctx,
      params.principalId,
      params.cartridgeId,
      params.actionType,
    );

    // 2c. Check per-org action type restrictions
    const restrictionResult = await this.checkRestriction(params, effectiveIdentity);
    if (restrictionResult) return restrictionResult;

    // 3-4. Look up cartridge + enrich context + get risk input
    const cartridge = this.ctx.storage.cartridges.get(params.cartridgeId);
    if (!cartridge) {
      throw new Error(`Cartridge not found: ${params.cartridgeId}`);
    }

    const { enriched, riskInput } = await enrichAndGetRiskInput(
      this.ctx,
      cartridge,
      params.actionType,
      params.parameters,
      params.principalId,
      params.organizationId ?? null,
      params.cartridgeId,
    );

    // 5. Get guardrails from cartridge + hydrate state
    const guardrails = cartridge.getGuardrails();
    await hydrateGuardrailState(this.ctx, guardrails, params.actionType, params.parameters);

    // 6. Load policies (with optional cache)
    const policies = await this.loadPolicies(params.cartridgeId, params.organizationId ?? null);

    // Create proposal object
    const proposalId = `prop_${randomUUID()}`;
    const envelopeId = generateEnvelopeId();
    const traceId = params.traceId ?? `trace_${randomUUID()}`;
    const proposal: ActionProposal = {
      id: proposalId,
      actionType: params.actionType,
      parameters: {
        ...params.parameters,
        _principalId: params.principalId,
        _cartridgeId: params.cartridgeId,
        _organizationId: params.organizationId ?? null,
      },
      evidence: params.message ?? `Proposed ${params.actionType}`,
      confidence: 1.0,
      originatingMessageId: "",
    };

    // 7. Build evaluation context
    const evalContext: EvaluationContext = {
      actionType: params.actionType,
      parameters: params.parameters,
      cartridgeId: params.cartridgeId,
      principalId: params.principalId,
      organizationId: params.organizationId ?? null,
      riskCategory: riskInput.baseRisk,
      metadata: { ...enriched, envelopeId },
    };

    // 8. Build policy engine context
    let systemRiskPosture: import("@switchboard/schemas").SystemRiskPosture | undefined;
    if (this.ctx.governanceProfileStore) {
      const profile = await this.ctx.governanceProfileStore.get(params.organizationId ?? null);
      systemRiskPosture = profileToPosture(profile);
    } else if (this.ctx.riskPostureStore) {
      systemRiskPosture = await this.ctx.riskPostureStore.get();
    }

    const engineContext: PolicyEngineContext = {
      policies,
      guardrails,
      guardrailState: this.ctx.guardrailState,
      resolvedIdentity: effectiveIdentity,
      riskInput,
      compositeContext: await buildCompositeContext(
        this.ctx,
        params.principalId,
        params.organizationId ?? undefined,
      ),
      systemRiskPosture,
      spendLookup: await buildSpendLookup(
        this.ctx,
        params.principalId,
        params.organizationId ?? undefined,
      ),
    };

    // 9. Evaluate
    const decisionTrace = evaluate(
      proposal,
      evalContext,
      engineContext,
      this.ctx.riskScoringConfig ? { riskScoringConfig: this.ctx.riskScoringConfig } : undefined,
    );

    const now = new Date();
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

    // 10. Handle decision outcome
    const { approvalRequest, governanceNote } = await this.handleDecisionOutcome(
      envelope,
      proposal,
      decisionTrace,
      evalContext,
      effectiveIdentity,
      params,
      policies,
      now,
      traceId,
    );

    // 11. Save envelope + audit
    await this.ctx.storage.envelopes.save(envelope);
    clearProposeCaches(); // Invalidate spend/composite caches after envelope mutation
    const auditEntry = await this.ctx.ledger.record({
      eventType: envelope.status === "denied" ? "action.denied" : "action.proposed",
      actorType: "user",
      actorId: params.principalId,
      entityType: "action",
      entityId: proposal.id,
      riskCategory: decisionTrace.computedRiskScore.category,
      summary: `Action ${params.actionType} ${envelope.status}`,
      snapshot: {
        actionType: params.actionType,
        parameters: params.parameters,
        decision: decisionTrace.finalDecision,
        approvalRequired: decisionTrace.approvalRequired,
        riskScore: decisionTrace.computedRiskScore.rawScore,
        riskCategory: decisionTrace.computedRiskScore.category,
        matchedChecks: decisionTrace.checks
          .filter((c) => c.matched)
          .map((c) => ({ code: c.checkCode, effect: c.effect })),
        interpreterName: proposal.interpreterName ?? null,
        emergencyOverride: params.emergencyOverride ?? false,
      },
      evidence: [
        { type: "decision_trace", data: decisionTrace },
        { type: "evaluation_context", data: evalContext },
      ],
      envelopeId: envelope.id,
      organizationId: params.organizationId ?? undefined,
      traceId: traceId,
    });

    envelope.auditEntryIds = [auditEntry.id];
    await this.ctx.storage.envelopes.update(envelope.id, {
      auditEntryIds: envelope.auditEntryIds,
    });

    // Record metrics
    const metrics = getMetrics();
    const proposeDuration = Date.now() - proposeStart;
    metrics.proposalsTotal.inc({ actionType: params.actionType });
    metrics.proposalLatencyMs.observe({ actionType: params.actionType }, proposeDuration);
    if (decisionTrace.finalDecision === "deny") {
      metrics.proposalsDenied.inc({ actionType: params.actionType });
    }
    if (approvalRequest) {
      metrics.approvalsCreated.inc({ actionType: params.actionType });
    }
    span.setAttribute("envelope.id", envelope.id);
    span.setAttribute("decision", decisionTrace.finalDecision);
    span.setAttribute("duration.ms", proposeDuration);
    span.setStatus("OK");

    return {
      envelope,
      decisionTrace,
      approvalRequest,
      denied: decisionTrace.finalDecision === "deny",
      explanation: decisionTrace.explanation,
      governanceNote,
    };
  }

  async proposePlan(
    plan: ActionPlan,
    proposals: Array<{
      actionType: string;
      parameters: Record<string, unknown>;
      principalId: string;
      cartridgeId: string;
      organizationId?: string;
    }>,
    executeApproved: (envelopeId: string) => Promise<ExecuteResult>,
  ): Promise<{
    planDecision: "allow" | "deny" | "partial";
    results: ProposeResult[];
    explanation: string;
    planApprovalRequest?: ApprovalRequest;
    planEnvelope?: ActionEnvelope;
  }> {
    return proposePlan(this, this.ctx, plan, proposals, executeApproved);
  }

  async resolveAndPropose(params: {
    actionType: string;
    parameters: Record<string, unknown>;
    principalId: string;
    cartridgeId: string;
    entityRefs: Array<{ inputRef: string; entityType: string }>;
    message?: string;
    organizationId?: string | null;
    traceId?: string;
    emergencyOverride?: boolean;
    idempotencyKey?: string;
  }): Promise<
    | ProposeResult
    | { needsClarification: true; question: string }
    | { notFound: true; explanation: string }
  > {
    const cartridge = this.ctx.storage.cartridges.get(params.cartridgeId);
    if (!cartridge) {
      throw new Error(`Cartridge not found: ${params.cartridgeId}`);
    }

    if (params.entityRefs.length > 0) {
      const resolver: EntityResolver = {
        resolve: async (inputRef, entityType, context) => {
          if ("resolveEntity" in cartridge && typeof cartridge.resolveEntity === "function") {
            return (cartridge as { resolveEntity: EntityResolver["resolve"] }).resolveEntity(
              inputRef,
              entityType,
              context,
            );
          }
          return {
            id: `resolve_${randomUUID()}`,
            inputRef,
            resolvedType: entityType,
            resolvedId: "",
            resolvedName: "",
            confidence: 0,
            alternatives: [],
            status: "not_found" as const,
          };
        },
      };

      const resolverResult = await resolveEntities(params.entityRefs, resolver, {
        principalId: params.principalId,
      });

      if (resolverResult.ambiguous.length > 0) {
        return {
          needsClarification: true,
          question: buildClarificationQuestion(resolverResult.ambiguous),
        };
      }

      if (resolverResult.notFound.length > 0) {
        return {
          notFound: true,
          explanation: buildNotFoundExplanation(resolverResult.notFound),
        };
      }

      const resolvedParams = { ...params.parameters };
      for (const entity of resolverResult.resolved) {
        for (const [key, value] of Object.entries(resolvedParams)) {
          if (value === entity.inputRef) {
            resolvedParams[key] = entity.resolvedId;
          }
        }
        if (entity.resolvedType) {
          resolvedParams[`${entity.resolvedType}Id`] = entity.resolvedId;
        }
        resolvedParams["entityId"] = entity.resolvedId;
      }

      return this.propose({
        ...params,
        parameters: resolvedParams,
      });
    }

    return this.propose(params);
  }

  async simulate(params: {
    actionType: string;
    parameters: Record<string, unknown>;
    principalId: string;
    cartridgeId: string;
    organizationId?: string | null;
  }): Promise<SimulationResult> {
    const identitySpec = await this.ctx.storage.identity.getSpecByPrincipalId(params.principalId);
    if (!identitySpec) {
      throw new Error(`Identity spec not found for principal: ${params.principalId}`);
    }
    const overlays = await this.ctx.storage.identity.listOverlaysBySpecId(identitySpec.id);
    const resolvedIdentity = resolveIdentity(identitySpec, overlays, {
      cartridgeId: params.cartridgeId,
    });

    const effectiveIdentity = resolvedIdentity;

    const cartridge = this.ctx.storage.cartridges.get(params.cartridgeId);
    if (!cartridge) {
      throw new Error(`Cartridge not found: ${params.cartridgeId}`);
    }

    const enriched = await cartridge.enrichContext(
      params.actionType,
      params.parameters,
      await buildCartridgeContext(
        this.ctx,
        params.cartridgeId,
        params.principalId,
        params.organizationId ?? null,
      ),
    );

    const riskInput = await cartridge.getRiskInput(params.actionType, params.parameters, {
      principalId: params.principalId,
      ...enriched,
    });

    const guardrails = cartridge.getGuardrails();
    await hydrateGuardrailState(this.ctx, guardrails, params.actionType, params.parameters);

    const policies = await this.loadPolicies(params.cartridgeId, null);

    const proposal: ActionProposal = {
      id: `sim_${randomUUID()}`,
      actionType: params.actionType,
      parameters: params.parameters,
      evidence: "Simulation",
      confidence: 1.0,
      originatingMessageId: "",
    };

    const evalContext: EvaluationContext = {
      actionType: params.actionType,
      parameters: params.parameters,
      cartridgeId: params.cartridgeId,
      principalId: params.principalId,
      organizationId: params.organizationId ?? null,
      riskCategory: riskInput.baseRisk,
      metadata: { ...enriched, envelopeId: "simulation" },
    };

    const engineContext: PolicyEngineContext = {
      policies,
      guardrails,
      guardrailState: this.ctx.guardrailState,
      resolvedIdentity: effectiveIdentity,
      riskInput,
    };

    return policySimulate(
      proposal,
      evalContext,
      engineContext,
      this.ctx.riskScoringConfig ? { riskScoringConfig: this.ctx.riskScoringConfig } : undefined,
    );
  }

  // ── Private helpers ──

  private async loadPolicies(
    cartridgeId: string,
    organizationId: string | null,
  ): Promise<import("@switchboard/schemas").Policy[]> {
    if (this.ctx.policyCache) {
      const cached = await this.ctx.policyCache.get(cartridgeId, organizationId);
      if (cached !== null) {
        return cached;
      }
      const policies = await this.ctx.storage.policies.listActive({
        cartridgeId,
        organizationId,
      });
      await this.ctx.policyCache.set(
        cartridgeId,
        organizationId,
        policies,
        DEFAULT_POLICY_CACHE_TTL_MS,
      );
      return policies;
    }
    return this.ctx.storage.policies.listActive({ cartridgeId, organizationId });
  }

  /**
   * Validate that _forceApproval is only used by principals with admin or approver roles.
   */
  private async isForceApprovalAllowed(params: {
    parameters: Record<string, unknown>;
    principalId: string;
  }): Promise<boolean> {
    if (params.parameters["_forceApproval"] !== true) return false;

    const principal = await this.ctx.storage.identity.getPrincipal(params.principalId);
    const hasRole = principal?.roles.some((r) => r === "admin" || r === "approver");
    if (!hasRole) {
      throw new Error("_forceApproval requires admin or approver role");
    }
    return true;
  }

  private async checkRestriction(
    params: {
      actionType: string;
      parameters: Record<string, unknown>;
      principalId: string;
      organizationId?: string | null;
      message?: string;
      parentEnvelopeId?: string | null;
      traceId?: string;
    },
    _effectiveIdentity: ResolvedIdentity,
  ): Promise<ProposeResult | null> {
    if (!this.ctx.governanceProfileStore) return null;

    const profileConfig = await this.ctx.governanceProfileStore.getConfig(
      params.organizationId ?? null,
    );
    const restriction = checkActionTypeRestriction(params.actionType, profileConfig);
    if (!restriction) return null;

    const now = new Date();
    const deniedEnvelopeId = generateEnvelopeId();
    const deniedProposalId = `prop_${randomUUID()}`;
    const traceId = params.traceId ?? `trace_${randomUUID()}`;

    const deniedEnvelope: ActionEnvelope = {
      id: deniedEnvelopeId,
      version: 1,
      incomingMessage: params.message ?? null,
      conversationId: null,
      proposals: [
        {
          id: deniedProposalId,
          actionType: params.actionType,
          parameters: params.parameters,
          evidence: params.message ?? `Proposed ${params.actionType}`,
          confidence: 1.0,
          originatingMessageId: "",
        },
      ],
      resolvedEntities: [],
      plan: null,
      decisions: [],
      approvalRequests: [],
      executionResults: [],
      auditEntryIds: [],
      status: "denied",
      createdAt: now,
      updatedAt: now,
      parentEnvelopeId: params.parentEnvelopeId ?? null,
      traceId,
    };

    await this.ctx.storage.envelopes.save(deniedEnvelope);
    clearProposeCaches(); // Invalidate spend/composite caches after envelope mutation

    await this.ctx.ledger.record({
      eventType: "action.denied",
      actorType: "system",
      actorId: "orchestrator",
      entityType: "action",
      entityId: deniedProposalId,
      riskCategory: "low",
      summary: `Action denied: ${restriction}`,
      snapshot: { actionType: params.actionType, reason: restriction },
      envelopeId: deniedEnvelopeId,
      traceId,
    });

    return {
      envelope: deniedEnvelope,
      decisionTrace: {
        actionId: deniedProposalId,
        envelopeId: deniedEnvelopeId,
        checks: [],
        computedRiskScore: { rawScore: 0, category: "low" as const, factors: [] },
        finalDecision: "deny" as const,
        approvalRequired: "none" as const,
        explanation: restriction,
        evaluatedAt: now,
      },
      approvalRequest: null,
      denied: true,
      explanation: restriction,
    };
  }

  private async handleDecisionOutcome(
    envelope: ActionEnvelope,
    proposal: ActionProposal,
    decisionTrace: import("@switchboard/schemas").DecisionTrace,
    evalContext: EvaluationContext,
    effectiveIdentity: ResolvedIdentity,
    params: {
      actionType: string;
      parameters: Record<string, unknown>;
      principalId: string;
      organizationId?: string | null;
      cartridgeId: string;
      emergencyOverride?: boolean;
    },
    policies: import("@switchboard/schemas").Policy[],
    now: Date,
    traceId: string,
  ): Promise<{ approvalRequest: ApprovalRequest | null; governanceNote?: string }> {
    let approvalRequest: ApprovalRequest | null = null;
    let governanceNote: string | undefined;

    const isObserveMode = effectiveIdentity.governanceProfile === "observe";
    const isEmergencyOverride = params.emergencyOverride === true;

    if (isEmergencyOverride) {
      const principal = await this.ctx.storage.identity.getPrincipal(params.principalId);
      if (principal?.type !== "user") {
        throw new Error("Emergency override is restricted to user principals");
      }
      const hasRole = principal.roles.some((r) => r === "admin" || r === "emergency_responder");
      if (!hasRole) {
        throw new Error("Emergency override requires admin or emergency_responder role");
      }
    }

    if (isObserveMode || isEmergencyOverride) {
      envelope.status = "approved";
      governanceNote = isEmergencyOverride
        ? "Auto-approved (emergency override): full governance evaluation ran but approval requirement was bypassed."
        : "Auto-approved (observe mode): full governance evaluation ran but approval requirement was bypassed.";
    } else if (decisionTrace.finalDecision === "deny") {
      envelope.status = "denied";
    } else if (
      decisionTrace.approvalRequired !== "none" ||
      (await this.isForceApprovalAllowed(params))
    ) {
      approvalRequest = await this.createApprovalRequest(
        envelope,
        proposal,
        decisionTrace,
        evalContext,
        params,
        policies,
        now,
        traceId,
      );
    } else {
      envelope.status = "approved";
    }

    return { approvalRequest, governanceNote };
  }

  private async createApprovalRequest(
    envelope: ActionEnvelope,
    proposal: ActionProposal,
    decisionTrace: import("@switchboard/schemas").DecisionTrace,
    evalContext: EvaluationContext,
    params: {
      actionType: string;
      parameters: Record<string, unknown>;
      principalId: string;
      organizationId?: string | null;
      cartridgeId: string;
    },
    policies: import("@switchboard/schemas").Policy[],
    now: Date,
    traceId: string,
  ): Promise<ApprovalRequest | null> {
    const identitySpec = await this.ctx.storage.identity.getSpecByPrincipalId(params.principalId);
    const overlays = identitySpec
      ? await this.ctx.storage.identity.listOverlaysBySpecId(identitySpec.id)
      : [];
    const resolvedIdentity = identitySpec
      ? resolveIdentity(identitySpec, overlays, { cartridgeId: params.cartridgeId })
      : ({} as ResolvedIdentity);

    const routing = routeApproval(
      decisionTrace.computedRiskScore.category,
      resolvedIdentity,
      this.ctx.routingConfig,
    );

    if (
      routing.approvalRequired !== "none" &&
      routing.approvers.length === 0 &&
      !routing.fallbackApprover
    ) {
      envelope.status = "denied";
      await this.ctx.storage.envelopes.save(envelope);
      await this.ctx.ledger.record({
        eventType: "action.denied",
        actorType: "system",
        actorId: "orchestrator",
        entityType: "action",
        entityId: proposal.id,
        riskCategory: decisionTrace.computedRiskScore.category,
        summary: `Action denied: approval required but no approvers configured`,
        snapshot: {
          actionType: params.actionType,
          approvalRequired: routing.approvalRequired,
          reason: "no_approvers_configured",
        },
        envelopeId: envelope.id,
        traceId,
      });
      return null;
    }

    const expiresAt = new Date(now.getTime() + routing.expiresInMs);

    const bindingHash = computeBindingHash({
      envelopeId: envelope.id,
      envelopeVersion: envelope.version,
      actionId: proposal.id,
      parameters: params.parameters,
      decisionTraceHash: hashObject(decisionTrace),
      contextSnapshotHash: hashObject(evalContext),
    });

    const approvalId = generateApprovalId();
    const quorumRequired = extractQuorumFromPolicies(policies, evalContext);

    const approvalRequest: ApprovalRequest = {
      id: approvalId,
      actionId: proposal.id,
      envelopeId: envelope.id,
      conversationId: null,
      summary: buildActionSummary(params.actionType, params.parameters, params.principalId),
      riskCategory: decisionTrace.computedRiskScore.category,
      bindingHash,
      evidenceBundle: {
        decisionTrace,
        contextSnapshot: evalContext as unknown as Record<string, unknown>,
        identitySnapshot: resolvedIdentity as unknown as Record<string, unknown>,
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
      quorum: quorumRequired ? { required: quorumRequired, approvalHashes: [] } : null,
    };

    envelope.approvalRequests = [approvalRequest];
    envelope.status = "pending_approval";

    const approvalState = createApprovalState(
      expiresAt,
      quorumRequired ? { required: quorumRequired } : null,
    );
    await this.ctx.storage.approvals.save({
      request: approvalRequest,
      state: approvalState,
      envelopeId: envelope.id,
      organizationId: params.organizationId ?? null,
    });

    if (this.ctx.approvalNotifier) {
      const notification = buildApprovalNotification(approvalRequest, decisionTrace);
      this.ctx.approvalNotifier.notify(notification).catch((err) => {
        console.error("Failed to send approval notification:", err);
      });
    }

    return approvalRequest;
  }
}
