/* eslint-disable max-lines */
import { randomUUID } from "node:crypto";
import type {
  ActionEnvelope,
  ActionPlan,
  ActionProposal,
  ApprovalRequest,
  DecisionTrace,
  RiskCategory,
  CompetenceAdjustment,
  CompositeRiskContext,
} from "@switchboard/schemas";
import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type { PolicyEngineContext } from "../engine/policy-engine.js";
import type { SimulationResult } from "../engine/simulator.js";
import { type EvaluationContext, evaluateRule } from "../engine/rule-evaluator.js";
import type { EntityResolver } from "../engine/resolver.js";

import { evaluate, simulate as policySimulate } from "../engine/policy-engine.js";
import type { SpendLookup } from "../engine/policy-engine.js";
import { evaluatePlan } from "../engine/composites.js";
import { resolveIdentity, applyCompetenceAdjustments } from "../identity/spec.js";
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
import { smbPropose } from "../smb/pipeline.js";

import type { SharedContext } from "./shared-context.js";
import { buildCartridgeContext } from "./shared-context.js";
import type { ProposeResult } from "./lifecycle.js";

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
    // SMB tier branching
    if (this.ctx.tierStore && params.organizationId) {
      const tier = await this.ctx.tierStore.getTier(params.organizationId);
      if (tier === "smb") {
        const smbConfig = await this.ctx.tierStore.getSmbConfig(params.organizationId);
        if (smbConfig && this.ctx.smbActivityLog) {
          return smbPropose(params, {
            storage: this.ctx.storage,
            activityLog: this.ctx.smbActivityLog,
            guardrailState: this.ctx.guardrailState,
            guardrailStateStore: this.ctx.guardrailStateStore ?? null,
            orgConfig: smbConfig,
            approvalNotifier: this.ctx.approvalNotifier,
          });
        }
      }
    }

    // 1. Look up IdentitySpec + overlays
    const identitySpec = await this.ctx.storage.identity.getSpecByPrincipalId(params.principalId);
    if (!identitySpec) {
      throw new Error(`Identity spec not found for principal: ${params.principalId}`);
    }
    const overlays = await this.ctx.storage.identity.listOverlaysBySpecId(identitySpec.id);

    // 2. Resolve identity
    const resolvedIdentity = resolveIdentity(identitySpec, overlays, {
      cartridgeId: params.cartridgeId,
    });

    // 2b. Apply competence adjustments
    let competenceAdjustments: CompetenceAdjustment[] = [];
    let effectiveIdentity = resolvedIdentity;
    if (this.ctx.competenceTracker) {
      const adj = await this.ctx.competenceTracker.getAdjustment(
        params.principalId,
        params.actionType,
      );
      if (adj) {
        competenceAdjustments = [adj];
        effectiveIdentity = applyCompetenceAdjustments(resolvedIdentity, competenceAdjustments);
      }
    }

    // 2c. Check per-org action type restrictions
    if (this.ctx.governanceProfileStore) {
      const profileConfig = await this.ctx.governanceProfileStore.getConfig(
        params.organizationId ?? null,
      );
      const restriction = checkActionTypeRestriction(params.actionType, profileConfig);
      if (restriction) {
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
    }

    // 3. Look up cartridge
    const cartridge = this.ctx.storage.cartridges.get(params.cartridgeId);
    if (!cartridge) {
      throw new Error(`Cartridge not found: ${params.cartridgeId}`);
    }

    // 3b. Enrich context from cartridge
    let enriched: Record<string, unknown> = {};
    try {
      enriched = await cartridge.enrichContext(
        params.actionType,
        params.parameters,
        await buildCartridgeContext(
          this.ctx,
          params.cartridgeId,
          params.principalId,
          params.organizationId ?? null,
        ),
      );
    } catch (err) {
      console.warn(
        `[orchestrator] enrichContext failed, proceeding with empty context: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 3c. Cross-cartridge enrichment (optional, fail-safe)
    if (this.ctx.crossCartridgeEnricher && params.organizationId) {
      try {
        const crossCartridgeContext = await this.ctx.crossCartridgeEnricher.enrich({
          targetCartridgeId: params.cartridgeId,
          actionType: params.actionType,
          parameters: params.parameters,
          organizationId: params.organizationId,
          principalId: params.principalId,
        });
        if (Object.keys(crossCartridgeContext).length > 0) {
          enriched = { ...enriched, _crossCartridge: crossCartridgeContext };
        }
      } catch (err) {
        console.warn(
          `[orchestrator] cross-cartridge enrichment failed, proceeding without: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // 4. Get risk input from cartridge
    let riskInput: import("@switchboard/schemas").RiskInput;
    try {
      riskInput = await cartridge.getRiskInput(params.actionType, params.parameters, {
        principalId: params.principalId,
        ...enriched,
      });
    } catch (err) {
      console.warn(
        `[orchestrator] getRiskInput failed, using default medium risk: ${err instanceof Error ? err.message : String(err)}`,
      );
      riskInput = {
        baseRisk: "medium",
        exposure: { dollarsAtRisk: 0, blastRadius: 1 },
        reversibility: "full",
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      };
    }

    // 5. Get guardrails from cartridge
    const guardrails = cartridge.getGuardrails();

    // 5b. Hydrate guardrail state from store
    await this.hydrateGuardrailState(guardrails, params.actionType, params.parameters);

    // 6. Load policies (with optional cache)
    let policies: import("@switchboard/schemas").Policy[];
    if (this.ctx.policyCache) {
      const cached = await this.ctx.policyCache.get(
        params.cartridgeId,
        params.organizationId ?? null,
      );
      if (cached !== null) {
        policies = cached;
      } else {
        policies = await this.ctx.storage.policies.listActive({
          cartridgeId: params.cartridgeId,
          organizationId: params.organizationId ?? null,
        });
        await this.ctx.policyCache.set(
          params.cartridgeId,
          params.organizationId ?? null,
          policies,
          DEFAULT_POLICY_CACHE_TTL_MS,
        );
      }
    } else {
      policies = await this.ctx.storage.policies.listActive({
        cartridgeId: params.cartridgeId,
        organizationId: params.organizationId ?? null,
      });
    }

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
      competenceAdjustments,
      compositeContext: await this.buildCompositeContext(
        params.principalId,
        params.organizationId ?? undefined,
      ),
      systemRiskPosture,
      spendLookup: await this.buildSpendLookup(
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

    // Create the envelope
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
    let approvalRequest: ApprovalRequest | null = null;
    let governanceNote: string | undefined;

    const isObserveMode = effectiveIdentity.governanceProfile === "observe";
    const isEmergencyOverride = params.emergencyOverride === true;

    if (isEmergencyOverride) {
      const principal = await this.ctx.storage.identity.getPrincipal(params.principalId);
      const hasRole = principal?.roles.some((r) => r === "admin" || r === "emergency_responder");
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
      params.parameters["_forceApproval"] === true
    ) {
      // Approval needed
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

        return {
          envelope,
          decisionTrace,
          approvalRequest: null,
          denied: true,
          explanation: "Action denied: approval required but no approvers are configured.",
        };
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

      const quorumRequired = this.extractQuorumFromPolicies(policies, evalContext);

      approvalRequest = {
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
    } else {
      // Auto-allowed
      envelope.status = "approved";
    }

    // 11. Save envelope
    await this.ctx.storage.envelopes.save(envelope);

    // 12. Record audit entry
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
    _executeApproved: (envelopeId: string) => Promise<ExecuteResult>,
  ): Promise<{
    planDecision: "allow" | "deny" | "partial";
    results: ProposeResult[];
    explanation: string;
    planApprovalRequest?: ApprovalRequest;
    planEnvelope?: ActionEnvelope;
  }> {
    // Data-flow delegation
    if (plan.dataFlowSteps && plan.dataFlowSteps.length > 0 && this.ctx.dataFlowExecutor) {
      const firstProposal = proposals[0];
      const dataFlowResult = await this.ctx.dataFlowExecutor.execute(
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
      const result = await this.propose(proposal);
      results.push(result);
      decisionTraces.push(result.decisionTrace);
    }

    plan.proposalOrder = results.map((r) => r.envelope.proposals[0]?.id ?? "");

    const planResult = evaluatePlan(plan, decisionTraces);

    // For atomic strategy, if any denied, mark all as denied
    if (plan.strategy === "atomic" && planResult.planDecision === "deny") {
      for (const result of results) {
        if (result.envelope.status !== "denied") {
          await this.ctx.storage.envelopes.update(result.envelope.id, { status: "denied" });
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
            await this.ctx.storage.envelopes.update(result.envelope.id, { status: "denied" });
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

        const allApprovers = [
          ...new Set(pendingResults.flatMap((r) => r.approvalRequest!.approvers)),
        ];

        const fallbackApprover =
          pendingResults.map((r) => r.approvalRequest!.fallbackApprover).find((f) => f !== null) ??
          null;

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
        await this.ctx.storage.envelopes.save(planEnvelope);

        const approvalState = createApprovalState(expiresAt, null);
        await this.ctx.storage.approvals.save({
          request: planApprovalRequest,
          state: approvalState,
          envelopeId: planEnvelopeId,
          organizationId: proposals[0]?.organizationId ?? null,
        });

        for (const result of pendingResults) {
          await this.ctx.storage.envelopes.update(result.envelope.id, { status: "queued" });
          result.envelope.status = "queued" as ActionEnvelope["status"];
        }

        for (const result of pendingResults) {
          result.approvalRequest = null;
        }

        if (this.ctx.approvalNotifier) {
          const notification = buildApprovalNotification(planApprovalRequest, decisionTraces[0]!);
          this.ctx.approvalNotifier.notify(notification).catch((err) => {
            console.error("Failed to send plan approval notification:", err);
          });
        }

        return {
          planDecision: planResult.planDecision,
          results,
          explanation: planResult.explanation,
          planApprovalRequest,
          planEnvelope,
        };
      }
    }

    return {
      planDecision: planResult.planDecision,
      results,
      explanation: planResult.explanation,
    };
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

    let competenceAdjustments: CompetenceAdjustment[] = [];
    let effectiveIdentity = resolvedIdentity;
    if (this.ctx.competenceTracker) {
      const adj = await this.ctx.competenceTracker.getAdjustment(
        params.principalId,
        params.actionType,
      );
      if (adj) {
        competenceAdjustments = [adj];
        effectiveIdentity = applyCompetenceAdjustments(resolvedIdentity, competenceAdjustments);
      }
    }

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
    await this.hydrateGuardrailState(guardrails, params.actionType, params.parameters);

    let policiesSim: import("@switchboard/schemas").Policy[];
    if (this.ctx.policyCache) {
      const cached = await this.ctx.policyCache.get(params.cartridgeId, null);
      if (cached !== null) {
        policiesSim = cached;
      } else {
        policiesSim = await this.ctx.storage.policies.listActive({
          cartridgeId: params.cartridgeId,
        });
        await this.ctx.policyCache.set(
          params.cartridgeId,
          null,
          policiesSim,
          DEFAULT_POLICY_CACHE_TTL_MS,
        );
      }
    } else {
      policiesSim = await this.ctx.storage.policies.listActive({
        cartridgeId: params.cartridgeId,
      });
    }

    const policies = policiesSim;

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
      competenceAdjustments,
    };

    return policySimulate(
      proposal,
      evalContext,
      engineContext,
      this.ctx.riskScoringConfig ? { riskScoringConfig: this.ctx.riskScoringConfig } : undefined,
    );
  }

  // ── Private helpers ──

  async hydrateGuardrailState(
    guardrails: import("@switchboard/schemas").GuardrailConfig | null,
    actionType: string,
    parameters: Record<string, unknown>,
  ): Promise<void> {
    if (!this.ctx.guardrailStateStore || !guardrails) return;

    const scopeKeys: string[] = [];
    for (const rl of guardrails.rateLimits) {
      const key = rl.scope === "global" ? "global" : `${rl.scope}:${actionType}`;
      scopeKeys.push(key);
    }

    const entityKeys: string[] = [];
    for (const cd of guardrails.cooldowns) {
      if (cd.actionType === actionType || cd.actionType === "*") {
        const entityId = (parameters["entityId"] as string) ?? "unknown";
        entityKeys.push(`${cd.scope}:${entityId}`);
      }
    }

    const [rateLimits, cooldowns] = await Promise.all([
      scopeKeys.length > 0
        ? this.ctx.guardrailStateStore.getRateLimits(scopeKeys)
        : Promise.resolve(new Map()),
      entityKeys.length > 0
        ? this.ctx.guardrailStateStore.getCooldowns(entityKeys)
        : Promise.resolve(new Map()),
    ]);

    for (const [key, entry] of rateLimits) {
      this.ctx.guardrailState.actionCounts.set(key, entry);
    }
    for (const [key, timestamp] of cooldowns) {
      this.ctx.guardrailState.lastActionTimes.set(key, timestamp);
    }
  }

  private extractQuorumFromPolicies(
    policies: import("@switchboard/schemas").Policy[],
    evalContext: EvaluationContext,
  ): number | null {
    const sorted = [...policies].filter((p) => p.active).sort((a, b) => a.priority - b.priority);
    for (const policy of sorted) {
      if (policy.cartridgeId && policy.cartridgeId !== evalContext.cartridgeId) continue;
      if (policy.effect !== "require_approval") continue;
      if (!policy.effectParams) continue;

      const ruleResult = evaluateRule(policy.rule, evalContext);
      if (!ruleResult.matched) continue;

      const quorum = policy.effectParams["quorum"];
      if (typeof quorum === "number" && quorum >= 1) {
        return quorum;
      }
    }
    return null;
  }

  private async buildSpendLookup(
    principalId: string,
    organizationId?: string,
  ): Promise<SpendLookup> {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const weekMs = 7 * dayMs;
    const monthMs = 30 * dayMs;

    let allEnvelopes: import("@switchboard/schemas").ActionEnvelope[];
    try {
      allEnvelopes = await this.ctx.storage.envelopes.list({
        limit: 500,
        organizationId,
      });
    } catch {
      return { dailySpend: 0, weeklySpend: 0, monthlySpend: 0 };
    }

    let dailySpend = 0;
    let weeklySpend = 0;
    let monthlySpend = 0;

    for (const env of allEnvelopes) {
      if (env.status !== "executed") continue;
      const isPrincipal = env.proposals.some((p) => p.parameters["_principalId"] === principalId);
      if (!isPrincipal) continue;

      for (const p of env.proposals) {
        const amount =
          typeof p.parameters["amount"] === "number"
            ? Math.abs(p.parameters["amount"])
            : typeof p.parameters["budgetChange"] === "number"
              ? Math.abs(p.parameters["budgetChange"])
              : 0;

        if (amount === 0) continue;

        const age = now - env.createdAt.getTime();
        if (age < monthMs) monthlySpend += amount;
        if (age < weekMs) weeklySpend += amount;
        if (age < dayMs) dailySpend += amount;
      }
    }

    return { dailySpend, weeklySpend, monthlySpend };
  }

  private async buildCompositeContext(
    principalId: string,
    organizationId?: string,
  ): Promise<CompositeRiskContext | undefined> {
    const windowMs = 60 * 60 * 1000;
    const cutoff = new Date(Date.now() - windowMs);

    let allRecentEnvelopes: import("@switchboard/schemas").ActionEnvelope[];
    try {
      allRecentEnvelopes = await this.ctx.storage.envelopes.list({
        limit: 200,
        organizationId,
      });
    } catch {
      return undefined;
    }

    const windowEnvelopes = allRecentEnvelopes.filter((e) => {
      if (e.createdAt < cutoff) return false;
      return e.proposals.some((p) => p.parameters["_principalId"] === principalId);
    });

    if (windowEnvelopes.length === 0) return undefined;

    let cumulativeExposure = 0;
    const targetEntities = new Set<string>();
    const cartridges = new Set<string>();

    for (const env of windowEnvelopes) {
      for (const decision of env.decisions) {
        const dollarsFactor = decision.computedRiskScore.factors.find(
          (f) => f.factor === "dollars_at_risk",
        );
        if (dollarsFactor) {
          cumulativeExposure += dollarsFactor.contribution;
        }
      }

      for (const proposal of env.proposals) {
        const entityId = proposal.parameters["entityId"] as string | undefined;
        if (entityId) targetEntities.add(entityId);

        const cartridgeId = proposal.parameters["_cartridgeId"] as string | undefined;
        if (cartridgeId) cartridges.add(cartridgeId);
      }
    }

    return {
      recentActionCount: windowEnvelopes.length,
      windowMs,
      cumulativeExposure,
      distinctTargetEntities: targetEntities.size,
      distinctCartridges: cartridges.size,
    };
  }
}
