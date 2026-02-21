import type {
  ActionEnvelope,
  ActionProposal,
  ApprovalRequest,
  DecisionTrace,
  RiskCategory,
  UndoRecipe,
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
import { resolveIdentity } from "../identity/spec.js";
import { routeApproval, DEFAULT_ROUTING_CONFIG } from "../approval/router.js";
import {
  createApprovalState,
  transitionApproval,
  isExpired,
} from "../approval/state-machine.js";
import { computeBindingHash, hashObject } from "../approval/binding.js";
import { applyPatch } from "../approval/patching.js";
import {
  resolveEntities,
  buildClarificationQuestion,
  buildNotFoundExplanation,
} from "../engine/resolver.js";

export interface OrchestratorConfig {
  storage: StorageContext;
  ledger: AuditLedger;
  guardrailState: GuardrailState;
  routingConfig?: ApprovalRoutingConfig;
  riskScoringConfig?: RiskScoringConfig;
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

let envelopeCounter = 0;
function generateEnvelopeId(): string {
  envelopeCounter++;
  return `env_${Date.now()}_${envelopeCounter}`;
}

let approvalCounter = 0;
function generateApprovalId(): string {
  approvalCounter++;
  return `appr_${Date.now()}_${approvalCounter}`;
}

export class LifecycleOrchestrator {
  private storage: StorageContext;
  private ledger: AuditLedger;
  private guardrailState: GuardrailState;
  private routingConfig: ApprovalRoutingConfig;
  private riskScoringConfig?: RiskScoringConfig;

  constructor(config: OrchestratorConfig) {
    this.storage = config.storage;
    this.ledger = config.ledger;
    this.guardrailState = config.guardrailState;
    this.routingConfig = config.routingConfig ?? DEFAULT_ROUTING_CONFIG;
    this.riskScoringConfig = config.riskScoringConfig;
  }

  async propose(params: {
    actionType: string;
    parameters: Record<string, unknown>;
    principalId: string;
    organizationId?: string | null;
    cartridgeId: string;
    message?: string;
    parentEnvelopeId?: string | null;
  }): Promise<ProposeResult> {
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

    // 6. Load policies
    const policies = await this.storage.policies.listActive({
      cartridgeId: params.cartridgeId,
    });

    // Create proposal object
    const proposalId = `prop_${Date.now()}_${envelopeCounter}`;
    const envelopeId = generateEnvelopeId();
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

    // 8. Build policy engine context
    const engineContext: PolicyEngineContext = {
      policies,
      guardrails,
      guardrailState: this.guardrailState,
      resolvedIdentity,
      riskInput,
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
    };

    // 10. Handle decision outcome
    let approvalRequest: ApprovalRequest | null = null;

    if (decisionTrace.finalDecision === "deny") {
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
        summary: `${params.actionType}: ${JSON.stringify(params.parameters)}`,
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
    } else {
      // Auto-allowed
      envelope.status = "approved";
    }

    // 11. Save envelope
    await this.storage.envelopes.save(envelope);

    // 12. Record audit entry
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
      },
      envelopeId: envelope.id,
      organizationId: params.organizationId ?? undefined,
    });

    envelope.auditEntryIds = [auditEntry.id];
    await this.storage.envelopes.update(envelope.id, {
      auditEntryIds: envelope.auditEntryIds,
    });

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

    // 4. Transition approval state
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
      });

      // Auto-execute after approval
      executionResult = await this.executeApproved(envelope.id);
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
      });

      executionResult = await this.executeApproved(envelope.id);
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

    let executeResult: ExecuteResult;
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
          principalId: envelope.proposals[0]?.parameters["principalId"] as string ?? "",
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

    // 5. Record audit entry
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
      envelopeId: envelope.id,
    });

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
    const policies = await this.storage.policies.listActive({
      cartridgeId: params.cartridgeId,
    });

    const proposal: ActionProposal = {
      id: `sim_${Date.now()}`,
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
      resolvedIdentity,
      riskInput,
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
            id: `resolve_${Date.now()}`,
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

  private inferCartridgeId(actionType: string): string | null {
    // Infer cartridge from action type prefix: "ads.campaign.pause" -> "ads-spend"
    if (actionType.startsWith("ads.")) return "ads-spend";
    // Add more mappings as needed
    return null;
  }
}
