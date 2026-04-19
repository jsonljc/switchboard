/* eslint-disable max-lines */
import { timingSafeEqual } from "node:crypto";
import type { RiskCategory, ActionEnvelope, ActionProposal, RiskInput } from "@switchboard/schemas";
import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import { transitionApproval, isExpired } from "../approval/state-machine.js";
import { canApproveWithChain } from "../approval/delegation.js";
import { applyPatch } from "../approval/patching.js";
import type { ApprovalState } from "../approval/state-machine.js";
import type { AuditLedger } from "../audit/ledger.js";
import type { TrustScoreAdapter } from "../marketplace/trust-adapter.js";
import { evaluate } from "../engine/policy-engine.js";
import type { PolicyEngineContext, GuardrailState } from "../engine/policy-engine.js";
import type { EvaluationContext } from "../engine/rule-evaluator.js";
import { resolveIdentity } from "../identity/spec.js";

import type { ExecutionModeRegistry } from "./execution-mode-registry.js";
import type { ExecutionConstraints } from "./governance-types.js";
import type { ExecutionResult } from "./execution-result.js";
import type { WorkUnit } from "./work-unit.js";
import type { WorkTrace } from "./work-trace.js";
import type { WorkTraceStore } from "./work-trace-recorder.js";
import type { ExecutionModeName } from "./types.js";
import type { PlatformIngress } from "./platform-ingress.js";
import { DEFAULT_CONSTRAINTS } from "./governance/constraint-resolver.js";

import type {
  ApprovalStore as CoreApprovalStore,
  EnvelopeStore as CoreEnvelopeStore,
  IdentityStore as CoreIdentityStore,
  CartridgeRegistry,
  PolicyStore,
} from "../storage/interfaces.js";

type ApprovalStore = CoreApprovalStore;
type EnvelopeStore = CoreEnvelopeStore;
type IdentityStore = CoreIdentityStore;

type ApprovalRecord = NonNullable<Awaited<ReturnType<CoreApprovalStore["getById"]>>>;

interface UndoRecipe {
  reverseActionType: string;
  reverseParameters: Record<string, unknown>;
  originalActionId: string;
  undoExpiresAt: Date;
}

export interface PlatformLifecycleConfig {
  approvalStore: ApprovalStore;
  envelopeStore: EnvelopeStore;
  identityStore: IdentityStore;
  modeRegistry: ExecutionModeRegistry;
  traceStore: WorkTraceStore;
  ledger: AuditLedger;
  trustAdapter?: TrustScoreAdapter | null;
  selfApprovalAllowed?: boolean;
  approvalRateLimit?: { maxApprovals: number; windowMs: number } | null;
  cartridgeRegistry?: CartridgeRegistry;
  policyStore?: PolicyStore;
  guardrailState?: GuardrailState;
}

export interface ApprovalResponseResult {
  envelope: ActionEnvelope;
  approvalState: ApprovalState;
  executionResult: ExecuteResult | null;
}

export class PlatformLifecycle {
  private readonly config: PlatformLifecycleConfig;
  private approvalResponseTimes = new Map<string, number[]>();

  constructor(config: PlatformLifecycleConfig) {
    this.config = config;
  }

  async respondToApproval(params: {
    approvalId: string;
    action: "approve" | "reject" | "patch";
    respondedBy: string;
    bindingHash: string;
    patchValue?: Record<string, unknown>;
  }): Promise<ApprovalResponseResult> {
    const { approvalStore, envelopeStore, ledger } = this.config;

    const approval = await approvalStore.getById(params.approvalId);
    if (!approval) {
      throw new Error(`Approval not found: ${params.approvalId}`);
    }

    const expiredResult = await this.handleExpired(approval, params.approvalId);
    if (expiredResult) return expiredResult;

    this.validateBindingHash(params, approval);
    await this.authorizeResponder(params.respondedBy, approval);

    const envelope = await envelopeStore.getById(approval.envelopeId);
    const trace = await this.config.traceStore.getByWorkUnitId(approval.envelopeId);

    this.preventSelfApprovalFromTrace(params, trace, envelope);
    this.checkRateLimit(params);

    const versionBefore = approval.state.version;
    const newState = transitionApproval(
      approval.state,
      params.action,
      params.respondedBy,
      params.patchValue,
    );
    await approvalStore.updateState(params.approvalId, newState, versionBefore);

    let executionResult: ExecuteResult | null = null;

    const respondedAt = new Date().toISOString();

    const workUnitId = approval.envelopeId;

    if (params.action === "approve" && newState.status === "approved") {
      if (envelope) await envelopeStore.update(envelope.id, { status: "approved" });

      await this.updateWorkTraceApproval(workUnitId, {
        approvalId: params.approvalId,
        approvalOutcome: "approved",
        approvalRespondedBy: params.respondedBy,
        approvalRespondedAt: respondedAt,
      });

      executionResult = await this.executeAfterApproval(workUnitId);

      if (envelope) await this.recordTrustEvent("approval", envelope);
      await ledger.record({
        eventType: "action.approved",
        actorType: "user",
        actorId: params.respondedBy,
        entityType: "action",
        entityId: approval.request.actionId,
        riskCategory: (approval.request.riskCategory as RiskCategory) ?? "low",
        summary: `Action approved by ${params.respondedBy}`,
        snapshot: { approvalId: params.approvalId },
        envelopeId: workUnitId,
        traceId: trace?.traceId ?? envelope?.traceId,
      });
    } else if (params.action === "reject") {
      if (envelope) await envelopeStore.update(envelope.id, { status: "denied" });

      await this.updateWorkTraceApproval(workUnitId, {
        approvalId: params.approvalId,
        approvalOutcome: "rejected",
        approvalRespondedBy: params.respondedBy,
        approvalRespondedAt: respondedAt,
        outcome: "failed",
        completedAt: respondedAt,
      });

      if (envelope) await this.recordTrustEvent("rejection", envelope);
      await ledger.record({
        eventType: "action.rejected",
        actorType: "user",
        actorId: params.respondedBy,
        entityType: "action",
        entityId: approval.request.actionId,
        riskCategory: (approval.request.riskCategory as RiskCategory) ?? "low",
        summary: `Action rejected by ${params.respondedBy}`,
        snapshot: { approvalId: params.approvalId },
        envelopeId: workUnitId,
        traceId: trace?.traceId ?? envelope?.traceId,
      });
    } else if (params.action === "patch") {
      if (params.patchValue && envelope?.proposals[0]) {
        envelope.proposals[0].parameters = applyPatch(
          envelope.proposals[0].parameters,
          params.patchValue,
        );

        // Re-evaluate governance on patched parameters (safety shim 2A-i)
        const denied = await this.reEvaluatePatchedProposal(
          envelope.proposals[0],
          envelope,
          params.approvalId,
        );
        if (denied) {
          await this.updateWorkTraceApproval(workUnitId, {
            approvalId: params.approvalId,
            approvalOutcome: "rejected",
            approvalRespondedBy: params.respondedBy,
            approvalRespondedAt: respondedAt,
            outcome: "failed",
            completedAt: respondedAt,
          });
          const updatedEnvelope = (await envelopeStore.getById(envelope.id)) ?? envelope;
          return { envelope: updatedEnvelope, approvalState: newState, executionResult: null };
        }

        await envelopeStore.update(envelope.id, {
          status: "approved",
          proposals: envelope.proposals,
        });
      }

      await this.updateWorkTraceApproval(workUnitId, {
        approvalId: params.approvalId,
        approvalOutcome: "patched",
        approvalRespondedBy: params.respondedBy,
        approvalRespondedAt: respondedAt,
      });

      executionResult = await this.executeAfterApproval(workUnitId);

      await ledger.record({
        eventType: "action.patched",
        actorType: "user",
        actorId: params.respondedBy,
        entityType: "action",
        entityId: approval.request.actionId,
        riskCategory: (approval.request.riskCategory as RiskCategory) ?? "low",
        summary: `Action patched and approved by ${params.respondedBy}`,
        snapshot: { approvalId: params.approvalId, patchValue: params.patchValue },
        envelopeId: workUnitId,
        traceId: trace?.traceId ?? envelope?.traceId,
      });
    } else if (params.action === "approve" && newState.status !== "approved") {
      await ledger.record({
        eventType: "action.partially_approved",
        actorType: "user",
        actorId: params.respondedBy,
        entityType: "action",
        entityId: approval.request.actionId,
        riskCategory: (approval.request.riskCategory as RiskCategory) ?? "low",
        summary: `Partial approval received from ${params.respondedBy}`,
        snapshot: { approvalId: params.approvalId },
        envelopeId: workUnitId,
        traceId: trace?.traceId ?? envelope?.traceId,
      });
    }

    const updatedEnvelope = envelope
      ? ((await envelopeStore.getById(envelope.id)) ?? envelope)
      : null;
    return { envelope: updatedEnvelope!, approvalState: newState, executionResult };
  }

  async executeApproved(workUnitId: string): Promise<ExecuteResult> {
    return this.executeAfterApproval(workUnitId);
  }

  async requestUndo(
    envelopeId: string,
    ingress: PlatformIngress,
  ): Promise<{ undoSubmitted: boolean; undoWorkUnitId?: string; error?: string }> {
    const { envelopeStore, ledger } = this.config;

    const envelope = await envelopeStore.getById(envelopeId);
    if (!envelope) throw new Error(`Envelope not found: ${envelopeId}`);

    const execResult = envelope.executionResults.find(
      (r) => r["undoRecipe"] !== null && r["undoRecipe"] !== undefined,
    );
    const rawRecipe = execResult?.["undoRecipe"];
    if (!rawRecipe || typeof rawRecipe !== "object") {
      throw new Error("No undo recipe available for this action");
    }

    const undoRecipe = rawRecipe as unknown as UndoRecipe;
    if (new Date() > undoRecipe.undoExpiresAt) {
      throw new Error("Undo window has expired");
    }

    const principalId = (envelope.proposals[0]?.parameters["_principalId"] as string) ?? "system";
    const organizationId = (envelope.proposals[0]?.parameters["_organizationId"] as string) ?? "";

    await ledger.record({
      eventType: "action.undo_requested",
      actorType: "system",
      actorId: "orchestrator",
      entityType: "action",
      entityId: envelopeId,
      riskCategory: (envelope.decisions[0]?.computedRiskScore?.category as RiskCategory) ?? "none",
      summary: `Undo requested for envelope ${envelopeId}`,
      snapshot: {
        originalEnvelopeId: envelopeId,
        reverseActionType: undoRecipe.reverseActionType,
      },
      envelopeId,
    });

    const response = await ingress.submit({
      intent: undoRecipe.reverseActionType,
      parameters: undoRecipe.reverseParameters,
      actor: { id: principalId, type: "user" },
      organizationId,
      deployment: {
        deploymentId: "undo",
        skillSlug: undoRecipe.reverseActionType.split(".")[0] ?? "unknown",
        trustLevel: "supervised",
        trustScore: 0,
      },
      trigger: "api",
      parentWorkUnitId: envelopeId,
    });

    if (!response.ok) {
      return { undoSubmitted: false, error: response.error.message };
    }

    return { undoSubmitted: true, undoWorkUnitId: response.workUnit.id };
  }

  async simulate(_params: {
    intent: string;
    parameters: Record<string, unknown>;
    actorId: string;
    organizationId?: string;
  }): Promise<{
    governanceOutcome: string;
    riskScore: number;
    matchedPolicies: string[];
    constraints?: ExecutionConstraints;
  }> {
    // Phase 2 stub: simulate remains on the old orchestrator path for now.
    // Full migration requires GovernanceGate to support simulation mode
    // without cartridge dependency — tracked in Phase 7.
    return {
      governanceOutcome: "execute",
      riskScore: 0,
      matchedPolicies: [],
      constraints: DEFAULT_CONSTRAINTS,
    };
  }

  private async executeAfterApproval(workUnitId: string): Promise<ExecuteResult> {
    const { envelopeStore, modeRegistry, traceStore, ledger } = this.config;

    const trace = await traceStore.getByWorkUnitId(workUnitId);
    const envelope = await envelopeStore.getById(workUnitId);

    if (!trace && !envelope) {
      throw new Error(`No WorkTrace or envelope found for execution: ${workUnitId}`);
    }

    if (envelope && envelope.status !== "approved") {
      throw new Error(`Cannot execute: envelope status is ${envelope.status}, expected "approved"`);
    }

    const proposal = envelope?.proposals[0];

    const mode = (trace?.mode ?? "cartridge") as ExecutionModeName;
    const intent = trace?.intent ?? proposal?.actionType ?? workUnitId;
    const constraints = this.extractConstraints(trace);
    const parameters = trace?.parameters ?? proposal?.parameters ?? {};

    const workUnit: WorkUnit = {
      id: workUnitId,
      requestedAt: trace?.requestedAt ?? new Date().toISOString(),
      organizationId:
        trace?.organizationId ?? (proposal?.parameters["_organizationId"] as string) ?? "",
      actor: trace?.actor ?? {
        id: (proposal?.parameters["_principalId"] as string) ?? "system",
        type: "user",
      },
      intent,
      parameters,
      deployment: trace?.deploymentContext ?? {
        deploymentId: trace?.deploymentId ?? "unresolved",
        skillSlug: intent.split(".")[0] ?? "unknown",
        trustLevel: "supervised",
        trustScore: 0,
      },
      resolvedMode: mode,
      traceId: trace?.traceId ?? envelope?.traceId ?? workUnitId,
      trigger: trace?.trigger ?? "api",
      priority: "normal",
    };

    const executionStartedAt = new Date().toISOString();
    let executionResult: ExecutionResult;
    try {
      executionResult = await modeRegistry.dispatch(mode, workUnit, constraints, {
        traceId: workUnit.traceId,
        governanceDecision: {
          outcome: "execute",
          riskScore: trace?.riskScore ?? 0,
          budgetProfile: "default",
          constraints,
          matchedPolicies: trace?.matchedPolicies ?? [],
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      executionResult = {
        workUnitId,
        outcome: "failed",
        summary: message,
        outputs: {},
        mode,
        durationMs: 0,
        traceId: workUnit.traceId,
        error: { code: "EXECUTION_ERROR", message },
      };
    }

    const completedAt = new Date().toISOString();

    if (envelope) {
      const newStatus = executionResult.outcome === "completed" ? "executed" : "failed";
      await envelopeStore.update(workUnitId, { status: newStatus });
    }

    await traceStore.update(workUnitId, {
      outcome: executionResult.outcome,
      durationMs: executionResult.durationMs,
      error: executionResult.error,
      executionSummary: executionResult.summary,
      executionOutputs: executionResult.outputs,
      executionStartedAt,
      completedAt,
    });

    await ledger.record({
      eventType: executionResult.outcome === "completed" ? "action.executed" : "action.failed",
      actorType: "system",
      actorId: "platform",
      entityType: "action",
      entityId: proposal?.id ?? workUnitId,
      riskCategory: (envelope?.decisions[0]?.computedRiskScore?.category as RiskCategory) ?? "low",
      summary: executionResult.summary,
      snapshot: {
        outcome: executionResult.outcome,
        durationMs: executionResult.durationMs,
      },
      envelopeId: workUnitId,
      traceId: workUnit.traceId,
    });

    return {
      success: executionResult.outcome === "completed",
      summary: executionResult.summary,
      externalRefs: (executionResult.outputs.externalRefs as Record<string, string>) ?? {},
      rollbackAvailable: false,
      partialFailures: executionResult.error
        ? [{ step: "execute", error: executionResult.error.message }]
        : [],
      durationMs: executionResult.durationMs,
      undoRecipe: null,
    };
  }

  private extractConstraints(trace: WorkTrace | null | undefined): ExecutionConstraints {
    if (trace?.governanceConstraints) return trace.governanceConstraints;
    return DEFAULT_CONSTRAINTS;
  }

  private async handleExpired(
    approval: ApprovalRecord,
    approvalId: string,
  ): Promise<ApprovalResponseResult | null> {
    if (!isExpired(approval.state)) return null;

    const { approvalStore, envelopeStore, ledger } = this.config;
    const expiredState = transitionApproval(approval.state, "expire");
    await approvalStore.updateState(approvalId, expiredState, approval.state.version);

    const envelope = await envelopeStore.getById(approval.envelopeId);
    if (!envelope) throw new Error("Envelope not found for expired approval");

    await envelopeStore.update(envelope.id, { status: "expired" });
    envelope.status = "expired";

    await ledger.record({
      eventType: "action.expired",
      actorType: "system",
      actorId: "platform",
      entityType: "approval",
      entityId: approvalId,
      riskCategory: (approval.request.riskCategory as RiskCategory) ?? "low",
      summary: `Approval expired for envelope ${approval.envelopeId}`,
      snapshot: { approvalId, envelopeId: approval.envelopeId },
      envelopeId: approval.envelopeId,
    });

    await this.updateWorkTraceOutcome(approval.envelopeId, "failed");
    return { envelope, approvalState: expiredState, executionResult: null };
  }

  private validateBindingHash(
    params: { action: string; bindingHash: string },
    approval: ApprovalRecord,
  ): void {
    if (params.action === "approve" || params.action === "patch") {
      const a = Buffer.from(params.bindingHash);
      const b = Buffer.from(approval.request.bindingHash);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        throw new Error(
          "Binding hash mismatch: action parameters may have changed (stale approval)",
        );
      }
    }
  }

  private async authorizeResponder(respondedBy: string, approval: ApprovalRecord): Promise<void> {
    if (approval.request.approvers.length === 0) return;

    const principal = await this.config.identityStore.getPrincipal(respondedBy);
    if (!principal) throw new Error(`Principal not found: ${respondedBy}`);

    const delegations = await this.config.identityStore.listDelegationRules(
      approval.organizationId ?? undefined,
    );
    const chainResult = canApproveWithChain(principal, approval.request.approvers, delegations);
    if (!chainResult.authorized) {
      throw new Error(`Principal ${respondedBy} is not authorized to respond to this approval`);
    }
  }

  private preventSelfApprovalFromTrace(
    params: { action: string; respondedBy: string },
    trace: WorkTrace | null | undefined,
    envelope: ActionEnvelope | null,
  ): void {
    if (
      (params.action === "approve" || params.action === "patch") &&
      !this.config.selfApprovalAllowed
    ) {
      const originator =
        trace?.actor?.id ??
        (envelope?.proposals[0]?.parameters["_principalId"] as string | undefined);
      if (originator && params.respondedBy === originator) {
        throw new Error("Self-approval is not permitted");
      }
    }
  }

  private checkRateLimit(params: { action: string; respondedBy: string }): void {
    const limit = this.config.approvalRateLimit;
    if (!limit || (params.action !== "approve" && params.action !== "patch")) return;

    const now = Date.now();
    const times = this.approvalResponseTimes.get(params.respondedBy) ?? [];
    const recent = times.filter((t) => now - t < limit.windowMs);
    if (recent.length >= limit.maxApprovals) {
      throw new Error("Approval rate limit exceeded. Try again later.");
    }
    recent.push(now);
    this.approvalResponseTimes.set(params.respondedBy, recent);
  }

  private async recordTrustEvent(
    type: "approval" | "rejection",
    envelope: ActionEnvelope,
  ): Promise<void> {
    const adapter = this.config.trustAdapter;
    if (!adapter || !envelope.proposals[0]) return;

    const proposal = envelope.proposals[0];
    const principalId = proposal.parameters["_principalId"] as string | undefined;
    if (!principalId) return;

    try {
      if (type === "approval") {
        await adapter.recordApproval(principalId, proposal.actionType);
      } else {
        await adapter.recordRejection(principalId, proposal.actionType);
      }
    } catch (err) {
      console.warn(
        `[platform-lifecycle] trust score update failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async updateWorkTraceApproval(
    workUnitId: string,
    fields: {
      approvalId: string;
      approvalOutcome: WorkTrace["approvalOutcome"];
      approvalRespondedBy: string;
      approvalRespondedAt: string;
      outcome?: WorkTrace["outcome"];
      completedAt?: string;
    },
  ): Promise<void> {
    try {
      await this.config.traceStore.update(workUnitId, fields);
    } catch {
      // Best-effort — trace may not exist for legacy envelopes
    }
  }

  private async updateWorkTraceOutcome(
    workUnitId: string,
    outcome: WorkTrace["outcome"],
  ): Promise<void> {
    try {
      await this.config.traceStore.update(workUnitId, {
        outcome,
        completedAt: new Date().toISOString(),
      });
    } catch {
      // Best-effort — trace may not exist for legacy envelopes
    }
  }

  /**
   * Re-evaluate governance on patched proposal parameters (safety shim 2A-i).
   * Ported from ApprovalManager.reEvaluatePatchedProposal to close the safety
   * gap where patched parameters could bypass policy checks.
   *
   * Returns `true` if the patched proposal was denied by policy.
   */
  private async reEvaluatePatchedProposal(
    proposal: ActionProposal,
    envelope: ActionEnvelope,
    approvalId: string,
  ): Promise<boolean> {
    const { cartridgeRegistry, policyStore, identityStore, envelopeStore, ledger } = this.config;

    // Skip re-evaluation when stores are not configured (default path)
    if (!cartridgeRegistry || !policyStore) return false;

    const principalId = (proposal.parameters["_principalId"] as string) ?? "";
    const cartridgeId = (proposal.parameters["_cartridgeId"] as string) ?? "";
    const patchOrgId = (proposal.parameters["_organizationId"] as string) ?? null;

    const identitySpec = await identityStore.getSpecByPrincipalId(principalId);
    if (!identitySpec) return false;

    const overlays = await identityStore.listOverlaysBySpecId(identitySpec.id);
    const reEvalIdentity = resolveIdentity(identitySpec, overlays, { cartridgeId });

    const cartridge = cartridgeRegistry.get(cartridgeId);
    if (!cartridge) return false;

    let riskInput: RiskInput;
    try {
      riskInput = await cartridge.getRiskInput(proposal.actionType, proposal.parameters, {
        principalId,
      });
    } catch (err) {
      console.warn(
        `[platform-lifecycle] getRiskInput failed during patch re-evaluation: ${err instanceof Error ? err.message : String(err)}`,
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
    const policies = await policyStore.listActive({ cartridgeId });

    const reEvalContext: EvaluationContext = {
      actionType: proposal.actionType,
      parameters: proposal.parameters,
      cartridgeId,
      principalId,
      organizationId: patchOrgId,
      riskCategory: riskInput.baseRisk,
      metadata: { envelopeId: envelope.id },
    };

    const guardrailState = this.config.guardrailState ?? {
      actionCounts: new Map(),
      lastActionTimes: new Map(),
    };

    const reEngineContext: PolicyEngineContext = {
      policies,
      guardrails,
      guardrailState,
      resolvedIdentity: reEvalIdentity,
      riskInput,
    };

    const reEvalTrace = evaluate(proposal, reEvalContext, reEngineContext);
    if (reEvalTrace.finalDecision === "deny") {
      envelope.status = "denied";
      await envelopeStore.update(envelope.id, {
        status: "denied",
        proposals: envelope.proposals,
      });
      await ledger.record({
        eventType: "action.denied",
        actorType: "system",
        actorId: "orchestrator",
        entityType: "action",
        entityId: proposal.id,
        riskCategory: reEvalTrace.computedRiskScore.category,
        summary: `Patched parameters denied by policy re-evaluation`,
        snapshot: {
          approvalId,
          reason: reEvalTrace.explanation,
        },
        envelopeId: envelope.id,
      });
      return true;
    }
    return false;
  }
}
