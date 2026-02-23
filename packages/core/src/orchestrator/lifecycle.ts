import { randomUUID } from "node:crypto";
import type {
  ActionEnvelope,
  ActionProposal,
  ApprovalRequest,
  DecisionTrace,
  RiskCategory,
  UndoRecipe,
  CompetenceAdjustment,
  CompositeRiskContext,
} from "@switchboard/schemas";
import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type { StorageContext } from "../storage/interfaces.js";
import type { AuditLedger } from "../audit/ledger.js";
import type { GuardrailState, PolicyEngineContext } from "../engine/policy-engine.js";
import type { ApprovalRoutingConfig } from "../approval/router.js";
import type { RiskScoringConfig } from "../engine/risk-scorer.js";
import type { ApprovalState } from "../approval/state-machine.js";
import type { SimulationResult } from "../engine/simulator.js";
import type { EvaluationContext } from "../engine/rule-evaluator.js";
import type { EntityResolver } from "../engine/resolver.js";

import { evaluate, simulate as policySimulate } from "../engine/policy-engine.js";
import { resolveIdentity, applyCompetenceAdjustments } from "../identity/spec.js";
import { routeApproval, DEFAULT_ROUTING_CONFIG } from "../approval/router.js";
import {
  createApprovalState,
  transitionApproval,
  isExpired,
} from "../approval/state-machine.js";
import { computeBindingHash, hashObject } from "../approval/binding.js";
import { applyPatch } from "../approval/patching.js";
import { canApproveWithChain } from "../approval/delegation.js";
import {
  resolveEntities,
  buildClarificationQuestion,
  buildNotFoundExplanation,
} from "../engine/resolver.js";
import type { CompetenceTracker } from "../competence/tracker.js";
import type { GuardrailStateStore } from "../guardrail-state/store.js";
import type { RiskPostureStore } from "../engine/risk-posture.js";
import type { GovernanceProfileStore } from "../governance/profile.js";
import { profileToPosture } from "../governance/profile.js";
import type { PolicyCache } from "../policy-cache.js";
import { DEFAULT_POLICY_CACHE_TTL_MS } from "../policy-cache.js";
import type { ApprovalNotifier } from "../notifications/notifier.js";
import { buildApprovalNotification } from "../notifications/notifier.js";
import { buildActionSummary } from "./summary-builder.js";
import { beginExecution, endExecution } from "../execution-guard.js";
import { getTracer } from "../telemetry/tracing.js";
import { getMetrics } from "../telemetry/metrics.js";

export type ExecutionMode = "inline" | "queue";

export type EnqueueCallback = (envelopeId: string) => Promise<void>;

export interface OrchestratorConfig {
  storage: StorageContext;
  ledger: AuditLedger;
  guardrailState: GuardrailState;
  guardrailStateStore?: GuardrailStateStore;
  routingConfig?: ApprovalRoutingConfig;
  riskScoringConfig?: RiskScoringConfig;
  competenceTracker?: CompetenceTracker;
  riskPostureStore?: RiskPostureStore;
  /** When set, per-org governance profile overrides system risk posture for propose. */
  governanceProfileStore?: GovernanceProfileStore;
  /** Optional policy cache (keyed by cartridgeId + org); invalidate on policy CRUD. */
  policyCache?: PolicyCache;
  executionMode?: ExecutionMode;
  onEnqueue?: EnqueueCallback;
  approvalNotifier?: ApprovalNotifier;
}

export interface ProposeResult {
  envelope: ActionEnvelope;
  decisionTrace: DecisionTrace;
  approvalRequest: ApprovalRequest | null;
  denied: boolean;
  explanation: string;
}

export interface ApprovalResponse {
  envelope: ActionEnvelope;
  approvalState: ApprovalState;
  executionResult: ExecuteResult | null;
}

function generateEnvelopeId(): string {
  return `env_${randomUUID()}`;
}

function generateApprovalId(): string {
  return `appr_${randomUUID()}`;
}

export class LifecycleOrchestrator {
  private storage: StorageContext;
  private ledger: AuditLedger;
  private guardrailState: GuardrailState;
  private guardrailStateStore: GuardrailStateStore | null;
  private routingConfig: ApprovalRoutingConfig;
  private riskScoringConfig?: RiskScoringConfig;
  private competenceTracker: CompetenceTracker | null;
  private riskPostureStore: RiskPostureStore | null;
  private governanceProfileStore: GovernanceProfileStore | null;
  private policyCache: PolicyCache | null;
  private executionMode: ExecutionMode;
  private onEnqueue: EnqueueCallback | null;
  private approvalNotifier: ApprovalNotifier | null;

  constructor(config: OrchestratorConfig) {
    this.storage = config.storage;
    this.ledger = config.ledger;
    this.guardrailState = config.guardrailState;
    this.guardrailStateStore = config.guardrailStateStore ?? null;
    this.routingConfig = config.routingConfig ?? DEFAULT_ROUTING_CONFIG;
    this.riskScoringConfig = config.riskScoringConfig;
    this.competenceTracker = config.competenceTracker ?? null;
    this.riskPostureStore = config.riskPostureStore ?? null;
    this.governanceProfileStore = config.governanceProfileStore ?? null;
    this.policyCache = config.policyCache ?? null;
    this.executionMode = config.executionMode ?? "inline";
    this.onEnqueue = config.onEnqueue ?? null;
    this.approvalNotifier = config.approvalNotifier ?? null;
  }

  async propose(params: {
    actionType: string;
    parameters: Record<string, unknown>;
    principalId: string;
    organizationId?: string | null;
    cartridgeId: string;
    message?: string;
    parentEnvelopeId?: string | null;
    traceId?: string;
  }): Promise<ProposeResult> {
    const span = getTracer().startSpan("orchestrator.propose", {
      "action.type": params.actionType,
      "principal.id": params.principalId,
      "cartridge.id": params.cartridgeId,
    });
    const proposeStart = Date.now();
    try {
    return await this._proposeInner(params, span, proposeStart);
    } catch (err) {
      span.setStatus("ERROR", err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      span.end();
    }
  }

  private async _proposeInner(params: {
    actionType: string;
    parameters: Record<string, unknown>;
    principalId: string;
    organizationId?: string | null;
    cartridgeId: string;
    message?: string;
    parentEnvelopeId?: string | null;
    traceId?: string;
  }, span: ReturnType<ReturnType<typeof getTracer>["startSpan"]>, proposeStart: number): Promise<ProposeResult> {
    // 1. Look up IdentitySpec + overlays
    const identitySpec = await this.storage.identity.getSpecByPrincipalId(params.principalId);
    if (!identitySpec) {
      throw new Error(`Identity spec not found for principal: ${params.principalId}`);
    }
    const overlays = await this.storage.identity.listOverlaysBySpecId(identitySpec.id);

    // 2. Resolve identity
    const resolvedIdentity = resolveIdentity(identitySpec, overlays, {
      cartridgeId: params.cartridgeId,
    });

    // 2b. Apply competence adjustments
    let competenceAdjustments: CompetenceAdjustment[] = [];
    let effectiveIdentity = resolvedIdentity;
    if (this.competenceTracker) {
      const adj = await this.competenceTracker.getAdjustment(params.principalId, params.actionType);
      if (adj) {
        competenceAdjustments = [adj];
        effectiveIdentity = applyCompetenceAdjustments(resolvedIdentity, competenceAdjustments);
      }
    }

    // 3. Look up cartridge
    const cartridge = this.storage.cartridges.get(params.cartridgeId);
    if (!cartridge) {
      throw new Error(`Cartridge not found: ${params.cartridgeId}`);
    }

    // 4. Get risk input from cartridge
    const riskInput = await cartridge.getRiskInput(
      params.actionType,
      params.parameters,
      { principalId: params.principalId },
    );

    // 5. Get guardrails from cartridge
    const guardrails = cartridge.getGuardrails();

    // 5b. Hydrate guardrail state from store
    await this.hydrateGuardrailState(guardrails, params.actionType, params.parameters);

    // 6. Load policies (with optional cache)
    let policies: import("@switchboard/schemas").Policy[];
    if (this.policyCache) {
      const cached = await this.policyCache.get(
        params.cartridgeId,
        params.organizationId ?? null,
      );
      if (cached !== null) {
        policies = cached;
      } else {
        policies = await this.storage.policies.listActive({
          cartridgeId: params.cartridgeId,
        });
        await this.policyCache.set(
          params.cartridgeId,
          params.organizationId ?? null,
          policies,
          DEFAULT_POLICY_CACHE_TTL_MS,
        );
      }
    } else {
      policies = await this.storage.policies.listActive({
        cartridgeId: params.cartridgeId,
      });
    }

    // Create proposal object
    const proposalId = `prop_${randomUUID()}`;
    const envelopeId = generateEnvelopeId();
    const traceId = params.traceId ?? `trace_${randomUUID()}`;
    const proposal: ActionProposal = {
      id: proposalId,
      actionType: params.actionType,
      parameters: { ...params.parameters, _principalId: params.principalId, _cartridgeId: params.cartridgeId },
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
      metadata: { envelopeId },
    };

    // 8. Build policy engine context (per-org governance profile overrides global posture when set)
    let systemRiskPosture: import("@switchboard/schemas").SystemRiskPosture | undefined;
    if (this.governanceProfileStore) {
      const profile = await this.governanceProfileStore.get(params.organizationId ?? null);
      systemRiskPosture = profileToPosture(profile);
    } else if (this.riskPostureStore) {
      systemRiskPosture = await this.riskPostureStore.get();
    }

    const engineContext: PolicyEngineContext = {
      policies,
      guardrails,
      guardrailState: this.guardrailState,
      resolvedIdentity: effectiveIdentity,
      riskInput,
      competenceAdjustments,
      compositeContext: await this.buildCompositeContext(params.principalId),
      systemRiskPosture,
    };

    // 9. Evaluate
    const decisionTrace = evaluate(
      proposal,
      evalContext,
      engineContext,
      this.riskScoringConfig ? { riskScoringConfig: this.riskScoringConfig } : undefined,
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

    // Observe mode: run full evaluation but force auto-approve regardless
    const isObserveMode = effectiveIdentity.governanceProfile === "observe";
    if (isObserveMode) {
      envelope.status = "approved";
    } else if (decisionTrace.finalDecision === "deny") {
      envelope.status = "denied";
    } else if (decisionTrace.approvalRequired !== "none") {
      // Approval needed
      const routing = routeApproval(
        decisionTrace.computedRiskScore.category,
        resolvedIdentity,
        this.routingConfig,
      );

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
      };

      envelope.approvalRequests = [approvalRequest];
      envelope.status = "pending_approval";

      const approvalState = createApprovalState(expiresAt);
      await this.storage.approvals.save({
        request: approvalRequest,
        state: approvalState,
        envelopeId: envelope.id,
      });

      // Push notification to approvers
      if (this.approvalNotifier) {
        const notification = buildApprovalNotification(approvalRequest, decisionTrace);
        this.approvalNotifier.notify(notification).catch((err) => {
          console.error("Failed to send approval notification:", err);
        });
      }
    } else {
      // Auto-allowed
      envelope.status = "approved";
    }

    // 11. Save envelope
    await this.storage.envelopes.save(envelope);

    // 12. Record audit entry (with evidence)
    const auditEntry = await this.ledger.record({
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
    await this.storage.envelopes.update(envelope.id, {
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
    };
  }

  async respondToApproval(params: {
    approvalId: string;
    action: "approve" | "reject" | "patch";
    respondedBy: string;
    bindingHash: string;
    patchValue?: Record<string, unknown>;
  }): Promise<ApprovalResponse> {
    // 1. Look up approval
    const approval = await this.storage.approvals.getById(params.approvalId);
    if (!approval) {
      throw new Error(`Approval not found: ${params.approvalId}`);
    }

    // 2. Check expired
    if (isExpired(approval.state)) {
      const expiredState = transitionApproval(approval.state, "expire");
      await this.storage.approvals.updateState(params.approvalId, expiredState);

      const envelope = await this.storage.envelopes.getById(approval.envelopeId);
      if (envelope) {
        await this.storage.envelopes.update(envelope.id, { status: "expired" });
        envelope.status = "expired";

        await this.ledger.record({
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
      if (params.bindingHash !== approval.request.bindingHash) {
        throw new Error("Binding hash mismatch: action parameters may have changed (stale approval)");
      }
    }

    // 4. Authorization check (only when approvers are configured)
    if (approval.request.approvers.length > 0) {
      const principal = await this.storage.identity.getPrincipal(params.respondedBy);
      if (!principal) {
        throw new Error(`Principal not found: ${params.respondedBy}`);
      }
      const delegations = await this.storage.identity.listDelegationRules();
      const chainResult = canApproveWithChain(principal, approval.request.approvers, delegations);
      if (!chainResult.authorized) {
        throw new Error(`Principal ${params.respondedBy} is not authorized to respond to this approval`);
      }

      // Record delegation chain audit entry if chain depth > 1
      if (chainResult.depth > 1) {
        await this.ledger.record({
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

    // 5. Transition approval state
    const newState = transitionApproval(
      approval.state,
      params.action,
      params.respondedBy,
      params.patchValue,
    );
    await this.storage.approvals.updateState(params.approvalId, newState);

    // Load envelope
    const envelope = await this.storage.envelopes.getById(approval.envelopeId);
    if (!envelope) {
      throw new Error(`Envelope not found: ${approval.envelopeId}`);
    }

    let executionResult: ExecuteResult | null = null;

    if (params.action === "approve") {
      envelope.status = "approved";
      await this.storage.envelopes.update(envelope.id, { status: "approved" });

      await this.ledger.record({
        eventType: "action.approved",
        actorType: "user",
        actorId: params.respondedBy,
        entityType: "action",
        entityId: approval.request.actionId,
        riskCategory: approval.request.riskCategory as RiskCategory,
        summary: `Action approved by ${params.respondedBy}`,
        snapshot: { approvalId: params.approvalId },
        envelopeId: envelope.id,
        traceId: envelope.traceId,
      });

      // Execute after approval: inline or enqueue
      if (this.executionMode === "queue" && this.onEnqueue) {
        await this.onEnqueue(envelope.id);
      } else {
        executionResult = await this.executeApproved(envelope.id);
      }
    } else if (params.action === "reject") {
      envelope.status = "denied";
      await this.storage.envelopes.update(envelope.id, { status: "denied" });

      await this.ledger.record({
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
      // Apply patch to parameters and re-evaluate
      const originalProposal = envelope.proposals[0];
      if (originalProposal && params.patchValue) {
        const patchedParams = applyPatch(
          originalProposal.parameters,
          params.patchValue,
        );
        originalProposal.parameters = patchedParams;

        // Re-evaluate patched parameters through the policy engine
        const principalId = (originalProposal.parameters["_principalId"] as string) ?? "";
        const cartridgeId = (originalProposal.parameters["_cartridgeId"] as string) ?? "";
        const identitySpec = await this.storage.identity.getSpecByPrincipalId(principalId);
        if (identitySpec) {
          const overlays = await this.storage.identity.listOverlaysBySpecId(identitySpec.id);
          const reEvalIdentity = resolveIdentity(identitySpec, overlays, { cartridgeId });
          const cartridge = this.storage.cartridges.get(cartridgeId);
          if (cartridge) {
            const riskInput = await cartridge.getRiskInput(
              originalProposal.actionType,
              patchedParams,
              { principalId },
            );
            const guardrails = cartridge.getGuardrails();
            const policies = await this.storage.policies.listActive({ cartridgeId });

            const reEvalProposal = { ...originalProposal, parameters: patchedParams };
            const reEvalContext: import("../engine/rule-evaluator.js").EvaluationContext = {
              actionType: originalProposal.actionType,
              parameters: patchedParams,
              cartridgeId,
              principalId,
              organizationId: null,
              riskCategory: riskInput.baseRisk,
              metadata: { envelopeId: envelope.id },
            };
            const reEngineContext: import("../engine/policy-engine.js").PolicyEngineContext = {
              policies,
              guardrails,
              guardrailState: this.guardrailState,
              resolvedIdentity: reEvalIdentity,
              riskInput,
            };

            const reEvalTrace = evaluate(reEvalProposal, reEvalContext, reEngineContext);
            if (reEvalTrace.finalDecision === "deny") {
              envelope.status = "denied";
              await this.storage.envelopes.update(envelope.id, { status: "denied", proposals: envelope.proposals });
              await this.ledger.record({
                eventType: "action.denied",
                actorType: "system",
                actorId: "orchestrator",
                entityType: "action",
                entityId: approval.request.actionId,
                riskCategory: reEvalTrace.computedRiskScore.category,
                summary: `Patched parameters denied by policy re-evaluation`,
                snapshot: { approvalId: params.approvalId, patchValue: params.patchValue, reason: reEvalTrace.explanation },
                envelopeId: envelope.id,
              });

              const updatedEnvelope = await this.storage.envelopes.getById(envelope.id);
              return { envelope: updatedEnvelope ?? envelope, approvalState: newState, executionResult: null };
            }
          }
        }
      }

      envelope.status = "approved";
      await this.storage.envelopes.update(envelope.id, {
        status: "approved",
        proposals: envelope.proposals,
      });

      await this.ledger.record({
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

      if (this.executionMode === "queue" && this.onEnqueue) {
        await this.onEnqueue(envelope.id);
      } else {
        executionResult = await this.executeApproved(envelope.id);
      }
    }

    // Re-fetch envelope to get latest state
    const updatedEnvelope = await this.storage.envelopes.getById(envelope.id);

    return {
      envelope: updatedEnvelope ?? envelope,
      approvalState: newState,
      executionResult,
    };
  }

  async executeApproved(envelopeId: string): Promise<ExecuteResult> {
    const execSpan = getTracer().startSpan("orchestrator.executeApproved", {
      "envelope.id": envelopeId,
    });
    const execStart = Date.now();

    // 1. Load envelope, verify status
    const envelope = await this.storage.envelopes.getById(envelopeId);
    if (!envelope) {
      throw new Error(`Envelope not found: ${envelopeId}`);
    }
    if (envelope.status !== "approved") {
      throw new Error(`Cannot execute: envelope status is ${envelope.status}, expected "approved"`);
    }

    const proposal = envelope.proposals[0];
    if (!proposal) {
      throw new Error("No proposals in envelope");
    }

    // 2. Look up cartridge
    const decision = envelope.decisions[0];
    const storedCartridgeId = proposal.parameters["_cartridgeId"] as string | undefined;
    const inferredCartridgeId = this.inferCartridgeId(proposal.actionType);
    const cartridge = this.storage.cartridges.get(
      storedCartridgeId ?? inferredCartridgeId ?? "",
    );
    if (!cartridge) {
      const result: ExecuteResult = {
        success: false,
        summary: `Cartridge not found for action: ${proposal.actionType}`,
        externalRefs: {},
        rollbackAvailable: false,
        partialFailures: [{ step: "execute", error: "Cartridge not found" }],
        durationMs: 0,
        undoRecipe: null,
      };
      await this.storage.envelopes.update(envelopeId, { status: "failed" });
      return result;
    }

    // 3. Execute
    await this.storage.envelopes.update(envelopeId, { status: "executing" });

    // Record pre-execution audit entry
    await this.ledger.record({
      eventType: "action.executing",
      actorType: "system",
      actorId: "orchestrator",
      entityType: "action",
      entityId: proposal.id,
      riskCategory: decision?.computedRiskScore.category ?? "low",
      summary: `Executing ${proposal.actionType}`,
      snapshot: {
        actionType: proposal.actionType,
        parameters: Object.fromEntries(
          Object.entries(proposal.parameters).filter(([k]) => !k.startsWith("_")),
        ),
        cartridgeId: storedCartridgeId ?? inferredCartridgeId ?? "",
      },
      envelopeId: envelope.id,
    });

    let executeResult: ExecuteResult;
    const execToken = beginExecution();
    try {
      // Pass envelope/action IDs to the cartridge for undo recipe building
      const execParams = {
        ...proposal.parameters,
        _envelopeId: envelope.id,
        _actionId: proposal.id,
      };

      executeResult = await cartridge.execute(
        proposal.actionType,
        execParams,
        {
          principalId: envelope.proposals[0]?.parameters["_principalId"] as string ?? "",
          organizationId: null,
          connectionCredentials: {},
        },
      );
    } catch (err) {
      executeResult = {
        success: false,
        summary: `Execution failed: ${err instanceof Error ? err.message : String(err)}`,
        externalRefs: {},
        rollbackAvailable: false,
        partialFailures: [{ step: "execute", error: String(err) }],
        durationMs: 0,
        undoRecipe: null,
      };
    } finally {
      endExecution(execToken);
    }

    // 4. Update envelope
    const newStatus = executeResult.success ? "executed" : "failed";
    await this.storage.envelopes.update(envelopeId, {
      status: newStatus,
      executionResults: [
        ...envelope.executionResults,
        {
          actionId: proposal.id,
          envelopeId: envelope.id,
          success: executeResult.success,
          summary: executeResult.summary,
          externalRefs: executeResult.externalRefs,
          rollbackAvailable: executeResult.rollbackAvailable,
          partialFailures: executeResult.partialFailures,
          durationMs: executeResult.durationMs,
          undoRecipe: executeResult.undoRecipe,
          executedAt: new Date(),
        },
      ],
    });

    // 5. Update guardrail state after successful execution
    if (executeResult.success) {
      this.updateGuardrailState(proposal, storedCartridgeId ?? inferredCartridgeId ?? "");
      await this.flushGuardrailState(proposal, storedCartridgeId ?? inferredCartridgeId ?? "");
    }

    // 5b. Record competence outcome
    if (this.competenceTracker) {
      const principalId = proposal.parameters["_principalId"] as string | undefined;
      if (principalId) {
        if (executeResult.success) {
          await this.competenceTracker.recordSuccess(principalId, proposal.actionType);
        } else {
          await this.competenceTracker.recordFailure(principalId, proposal.actionType);
        }
      }
    }

    // 6. Record audit entry (with evidence)
    await this.ledger.record({
      eventType: executeResult.success ? "action.executed" : "action.failed",
      actorType: "system",
      actorId: "orchestrator",
      entityType: "action",
      entityId: proposal.id,
      riskCategory: decision?.computedRiskScore.category ?? "low",
      summary: executeResult.summary,
      snapshot: {
        success: executeResult.success,
        externalRefs: executeResult.externalRefs,
        durationMs: executeResult.durationMs,
      },
      evidence: [
        { type: "execution_result", data: executeResult },
        ...(decision ? [{ type: "decision_trace", data: decision }] : []),
      ],
      envelopeId: envelope.id,
      traceId: envelope.traceId,
    });

    // Record execution metrics
    const execMetrics = getMetrics();
    const execDuration = Date.now() - execStart;
    execMetrics.executionsTotal.inc({ actionType: proposal.actionType });
    execMetrics.executionLatencyMs.observe({ actionType: proposal.actionType }, execDuration);
    if (executeResult.success) {
      execMetrics.executionsSuccess.inc({ actionType: proposal.actionType });
    } else {
      execMetrics.executionsFailed.inc({ actionType: proposal.actionType });
    }
    execSpan.setAttribute("success", executeResult.success);
    execSpan.setAttribute("duration.ms", execDuration);
    execSpan.setStatus(executeResult.success ? "OK" : "ERROR", executeResult.summary);
    execSpan.end();

    return executeResult;
  }

  async requestUndo(envelopeId: string): Promise<ProposeResult> {
    // 1. Load original envelope
    const envelope = await this.storage.envelopes.getById(envelopeId);
    if (!envelope) {
      throw new Error(`Envelope not found: ${envelopeId}`);
    }

    // Find execution result with undo recipe
    const execResult = envelope.executionResults.find(
      (r) => r.undoRecipe !== null && r.undoRecipe !== undefined,
    );
    if (!execResult || !execResult.undoRecipe) {
      throw new Error("No undo recipe available for this action");
    }

    const undoRecipe = execResult.undoRecipe as UndoRecipe;

    // 2. Check undo hasn't expired
    if (new Date() > undoRecipe.undoExpiresAt) {
      const principalId =
        (envelope.proposals[0]?.parameters["_principalId"] as string) ?? "system";

      await this.ledger.record({
        eventType: "action.expired",
        actorType: "user",
        actorId: principalId,
        entityType: "action",
        entityId: envelope.proposals[0]?.id ?? envelopeId,
        riskCategory: envelope.decisions[0]?.computedRiskScore.category ?? "low",
        summary: `Undo denied: window expired for envelope ${envelopeId}`,
        snapshot: {
          envelopeId,
          undoExpiresAt: undoRecipe.undoExpiresAt.toISOString(),
          attemptedAt: new Date().toISOString(),
        },
        envelopeId,
        traceId: envelope.traceId,
      });

      throw new Error("Undo window has expired");
    }

    // 3. Create new proposal from undo recipe
    // Infer cartridge from stored metadata or action type
    const originalProposal = envelope.proposals[0];
    const cartridgeId =
      (originalProposal?.parameters["_cartridgeId"] as string) ??
      this.inferCartridgeId(
        originalProposal?.actionType ?? undoRecipe.reverseActionType,
      );

    if (!cartridgeId) {
      throw new Error("Cannot determine cartridge for undo action");
    }

    // Use the original principal
    const principalId =
      (originalProposal?.parameters["_principalId"] as string) ?? "system";

    // Record rollback against original action type
    if (this.competenceTracker && originalProposal) {
      await this.competenceTracker.recordRollback(principalId, originalProposal.actionType);
    }

    // Record undo audit entry
    await this.ledger.record({
      eventType: "action.undo_requested",
      actorType: "system",
      actorId: "orchestrator",
      entityType: "action",
      entityId: envelope.id,
      riskCategory: (envelope.decisions[0]?.computedRiskScore.category ?? "none") as RiskCategory,
      summary: `Undo requested for envelope ${envelope.id}`,
      snapshot: { originalEnvelopeId: envelope.id, reverseActionType: undoRecipe.reverseActionType },
      envelopeId: envelope.id,
    });

    // 4. Run through propose() with parentEnvelopeId set
    return this.propose({
      actionType: undoRecipe.reverseActionType,
      parameters: undoRecipe.reverseParameters,
      principalId,
      cartridgeId,
      message: `Undo of action ${undoRecipe.originalActionId}`,
      parentEnvelopeId: envelopeId,
    });
  }

  async simulate(params: {
    actionType: string;
    parameters: Record<string, unknown>;
    principalId: string;
    cartridgeId: string;
  }): Promise<SimulationResult> {
    // Same as propose steps 1-8 but uses simulate()
    const identitySpec = await this.storage.identity.getSpecByPrincipalId(params.principalId);
    if (!identitySpec) {
      throw new Error(`Identity spec not found for principal: ${params.principalId}`);
    }
    const overlays = await this.storage.identity.listOverlaysBySpecId(identitySpec.id);
    const resolvedIdentity = resolveIdentity(identitySpec, overlays, {
      cartridgeId: params.cartridgeId,
    });

    // Apply competence adjustments
    let competenceAdjustments: CompetenceAdjustment[] = [];
    let effectiveIdentity = resolvedIdentity;
    if (this.competenceTracker) {
      const adj = await this.competenceTracker.getAdjustment(params.principalId, params.actionType);
      if (adj) {
        competenceAdjustments = [adj];
        effectiveIdentity = applyCompetenceAdjustments(resolvedIdentity, competenceAdjustments);
      }
    }

    const cartridge = this.storage.cartridges.get(params.cartridgeId);
    if (!cartridge) {
      throw new Error(`Cartridge not found: ${params.cartridgeId}`);
    }

    const riskInput = await cartridge.getRiskInput(
      params.actionType,
      params.parameters,
      { principalId: params.principalId },
    );

    const guardrails = cartridge.getGuardrails();

    // Hydrate guardrail state from store (read-only for simulation)
    await this.hydrateGuardrailState(guardrails, params.actionType, params.parameters);

    let policiesSim: import("@switchboard/schemas").Policy[];
    if (this.policyCache) {
      const cached = await this.policyCache.get(params.cartridgeId, null);
      if (cached !== null) {
        policiesSim = cached;
      } else {
        policiesSim = await this.storage.policies.listActive({
          cartridgeId: params.cartridgeId,
        });
        await this.policyCache.set(
          params.cartridgeId,
          null,
          policiesSim,
          DEFAULT_POLICY_CACHE_TTL_MS,
        );
      }
    } else {
      policiesSim = await this.storage.policies.listActive({
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
      organizationId: null,
      riskCategory: riskInput.baseRisk,
      metadata: { envelopeId: "simulation" },
    };

    const engineContext: PolicyEngineContext = {
      policies,
      guardrails,
      guardrailState: this.guardrailState,
      resolvedIdentity: effectiveIdentity,
      riskInput,
      competenceAdjustments,
    };

    return policySimulate(
      proposal,
      evalContext,
      engineContext,
      this.riskScoringConfig ? { riskScoringConfig: this.riskScoringConfig } : undefined,
    );
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
  }): Promise<
    | ProposeResult
    | { needsClarification: true; question: string }
    | { notFound: true; explanation: string }
  > {
    // 1. Look up cartridge
    const cartridge = this.storage.cartridges.get(params.cartridgeId);
    if (!cartridge) {
      throw new Error(`Cartridge not found: ${params.cartridgeId}`);
    }

    // 2. Resolve entities if any refs provided
    if (params.entityRefs.length > 0) {
      // Build an EntityResolver from the cartridge if it has resolveEntity
      const resolver: EntityResolver = {
        resolve: async (inputRef, entityType, context) => {
          if ("resolveEntity" in cartridge && typeof cartridge.resolveEntity === "function") {
            return (cartridge as { resolveEntity: EntityResolver["resolve"] }).resolveEntity(
              inputRef,
              entityType,
              context,
            );
          }
          // Default: not found
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

      const resolverResult = await resolveEntities(
        params.entityRefs,
        resolver,
        { principalId: params.principalId },
      );

      // 3. Handle ambiguous
      if (resolverResult.ambiguous.length > 0) {
        return {
          needsClarification: true,
          question: buildClarificationQuestion(resolverResult.ambiguous),
        };
      }

      // 4. Handle not found
      if (resolverResult.notFound.length > 0) {
        return {
          notFound: true,
          explanation: buildNotFoundExplanation(resolverResult.notFound),
        };
      }

      // 5. Substitute canonical IDs into parameters
      const resolvedParams = { ...params.parameters };
      for (const entity of resolverResult.resolved) {
        // Replace the ref with the resolved ID
        for (const [key, value] of Object.entries(resolvedParams)) {
          if (value === entity.inputRef) {
            resolvedParams[key] = entity.resolvedId;
          }
        }
        // Also set campaignId if that's what we resolved
        if (entity.resolvedType === "campaign") {
          resolvedParams["campaignId"] = entity.resolvedId;
        }
      }

      return this.propose({
        ...params,
        parameters: resolvedParams,
      });
    }

    // No entity refs - propose directly
    return this.propose(params);
  }

  private async hydrateGuardrailState(
    guardrails: import("@switchboard/schemas").GuardrailConfig | null,
    actionType: string,
    parameters: Record<string, unknown>,
  ): Promise<void> {
    if (!this.guardrailStateStore || !guardrails) return;

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
      scopeKeys.length > 0 ? this.guardrailStateStore.getRateLimits(scopeKeys) : Promise.resolve(new Map()),
      entityKeys.length > 0 ? this.guardrailStateStore.getCooldowns(entityKeys) : Promise.resolve(new Map()),
    ]);

    for (const [key, entry] of rateLimits) {
      this.guardrailState.actionCounts.set(key, entry);
    }
    for (const [key, timestamp] of cooldowns) {
      this.guardrailState.lastActionTimes.set(key, timestamp);
    }
  }

  private async flushGuardrailState(
    proposal: ActionProposal,
    cartridgeId: string,
  ): Promise<void> {
    if (!this.guardrailStateStore) return;

    const cartridge = this.storage.cartridges.get(cartridgeId);
    if (!cartridge) return;

    const guardrails = cartridge.getGuardrails();
    const writes: Promise<void>[] = [];

    for (const rl of guardrails.rateLimits) {
      const scopeKey = rl.scope === "global" ? "global" : `${rl.scope}:${proposal.actionType}`;
      const entry = this.guardrailState.actionCounts.get(scopeKey);
      if (entry) {
        writes.push(this.guardrailStateStore.setRateLimit(scopeKey, entry, rl.windowMs));
      }
    }

    for (const cd of guardrails.cooldowns) {
      if (cd.actionType === proposal.actionType || cd.actionType === "*") {
        const entityId = (proposal.parameters["entityId"] as string) ?? "unknown";
        const entityKey = `${cd.scope}:${entityId}`;
        const timestamp = this.guardrailState.lastActionTimes.get(entityKey);
        if (timestamp !== undefined) {
          writes.push(this.guardrailStateStore.setCooldown(entityKey, timestamp, cd.cooldownMs));
        }
      }
    }

    await Promise.all(writes);
  }

  private updateGuardrailState(proposal: ActionProposal, cartridgeId: string): void {
    const cartridge = this.storage.cartridges.get(cartridgeId);
    if (!cartridge) return;

    const guardrails = cartridge.getGuardrails();
    const now = Date.now();

    // Rate limit increment
    for (const rl of guardrails.rateLimits) {
      const scopeKey = rl.scope === "global" ? "global" : `${rl.scope}:${proposal.actionType}`;
      const current = this.guardrailState.actionCounts.get(scopeKey);

      if (current && now - current.windowStart < rl.windowMs) {
        current.count += 1;
      } else {
        this.guardrailState.actionCounts.set(scopeKey, { count: 1, windowStart: now });
      }
    }

    // Cooldown stamp
    for (const cd of guardrails.cooldowns) {
      if (cd.actionType === proposal.actionType || cd.actionType === "*") {
        const entityId = (proposal.parameters["entityId"] as string) ?? "unknown";
        const entityKey = `${cd.scope}:${entityId}`;
        this.guardrailState.lastActionTimes.set(entityKey, now);
      }
    }
  }

  private inferCartridgeId(actionType: string): string | null {
    return inferCartridgeId(actionType);
  }

  private async buildCompositeContext(principalId: string): Promise<CompositeRiskContext | undefined> {
    const windowMs = 60 * 60 * 1000; // 60 minutes
    const cutoff = new Date(Date.now() - windowMs);

    let allRecentEnvelopes: ActionEnvelope[];
    try {
      allRecentEnvelopes = await this.storage.envelopes.list({
        limit: 200,
      });
    } catch {
      return undefined;
    }

    // Filter to envelopes by this principal within the window
    const windowEnvelopes = allRecentEnvelopes.filter((e) => {
      if (e.createdAt < cutoff) return false;
      return e.proposals.some(
        (p) => p.parameters["_principalId"] === principalId,
      );
    });

    if (windowEnvelopes.length === 0) return undefined;

    let cumulativeExposure = 0;
    const targetEntities = new Set<string>();
    const cartridges = new Set<string>();

    for (const env of windowEnvelopes) {
      // Extract exposure from decisions
      for (const decision of env.decisions) {
        const dollarsFactor = decision.computedRiskScore.factors.find(
          (f) => f.factor === "dollars_at_risk",
        );
        if (dollarsFactor) {
          // Extract actual dollars from factor detail or use contribution as proxy
          cumulativeExposure += dollarsFactor.contribution;
        }
      }

      // Extract entity and cartridge from proposals
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

/**
 * Infer cartridge ID from action type prefix.
 * e.g. "ads.campaign.pause" -> "ads-spend"
 */
export function inferCartridgeId(actionType: string): string | null {
  if (actionType.startsWith("ads.")) return "ads-spend";
  return null;
}
