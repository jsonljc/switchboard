import type {
  ActionEnvelope,
  ActionPlan,
  ApprovalRequest,
  DecisionTrace,
} from "@switchboard/schemas";
import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type { StorageContext } from "../storage/interfaces.js";
import type { AuditLedger } from "../audit/ledger.js";
import type { GuardrailState } from "../engine/policy-engine.js";
import type { ApprovalRoutingConfig } from "../approval/router.js";
import type { RiskScoringConfig } from "../engine/risk-scorer.js";
import type { ApprovalState } from "../approval/state-machine.js";
import type { SimulationResult } from "../engine/simulator.js";
import type { CompetenceTracker } from "../competence/tracker.js";
import type { GuardrailStateStore } from "../guardrail-state/store.js";
import type { RiskPostureStore } from "../engine/risk-posture.js";
import type { GovernanceProfileStore } from "../governance/profile.js";
import type { PolicyCache } from "../policy-cache.js";
import type { ApprovalNotifier } from "../notifications/notifier.js";
import type { CrossCartridgeEnricher } from "../enrichment/types.js";
import type { DataFlowExecutor } from "../data-flow/executor.js";
import type { CartridgeCircuitBreakerWrapper } from "./circuit-breaker-wrapper.js";
import type { TrustScoreAdapter } from "../marketplace/trust-adapter.js";

import { DEFAULT_ROUTING_CONFIG } from "../approval/router.js";
import type { SharedContext } from "./shared-context.js";
import { ProposePipeline } from "./propose-pipeline.js";
import { ApprovalManager } from "./approval-manager.js";
import { ExecutionManager } from "./execution-manager.js";

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
  trustAdapter?: TrustScoreAdapter | null;
  riskPostureStore?: RiskPostureStore;
  /** When set, per-org governance profile overrides system risk posture for propose. */
  governanceProfileStore?: GovernanceProfileStore;
  /** Optional policy cache (keyed by cartridgeId + org); invalidate on policy CRUD. */
  policyCache?: PolicyCache;
  executionMode?: ExecutionMode;
  onEnqueue?: EnqueueCallback;
  approvalNotifier?: ApprovalNotifier;
  /** When true, allows a principal to approve their own proposals. Default: false. */
  selfApprovalAllowed?: boolean;
  /** Maximum approval responses per principal in a sliding window. */
  approvalRateLimit?: { maxApprovals: number; windowMs: number };
  /** Cross-cartridge context enricher — injects data from other cartridges into governance context. */
  crossCartridgeEnricher?: CrossCartridgeEnricher;
  /** Data-flow executor for multi-step plans with binding resolution. */
  dataFlowExecutor?: DataFlowExecutor;
  /** Credential resolver for org-scoped connection credentials at execution time. */
  credentialResolver?: import("../credentials/resolver.js").ConnectionCredentialResolver;
  /** Circuit breaker wrapper for cartridge execute calls. When set, wraps each cartridge.execute() in a per-cartridge circuit breaker. */
  circuitBreaker?: CartridgeCircuitBreakerWrapper;
  /** Idempotency guard for orchestrator-level deduplication of proposals. */
  idempotencyGuard?: import("../idempotency/guard.js").IdempotencyGuard;
}

export interface ProposeResult {
  envelope: ActionEnvelope;
  decisionTrace: DecisionTrace;
  approvalRequest: ApprovalRequest | null;
  denied: boolean;
  explanation: string;
  /** Set when observe mode or emergency override auto-approved the action. */
  governanceNote?: string;
}

export interface ApprovalResponse {
  envelope: ActionEnvelope;
  approvalState: ApprovalState;
  executionResult: ExecuteResult | null;
}

/**
 * LifecycleOrchestrator — thin coordinator delegating to:
 *  - ProposePipeline  (propose, proposePlan, simulate, resolveAndPropose)
 *  - ApprovalManager  (respondToApproval, respondToPlanApproval)
 *  - ExecutionManager  (executeApproved, executePlan, requestUndo)
 */
export class LifecycleOrchestrator {
  private proposePipeline: ProposePipeline;
  private approvalManager: ApprovalManager;
  private executionManager: ExecutionManager;
  private _routingConfig: ApprovalRoutingConfig;

  /** Approval routing configuration. Used by the actions route to create approval requests. */
  get routingConfig(): ApprovalRoutingConfig {
    return this._routingConfig;
  }

  constructor(config: OrchestratorConfig) {
    this._routingConfig = config.routingConfig ?? DEFAULT_ROUTING_CONFIG;
    const ctx: SharedContext = {
      storage: config.storage,
      ledger: config.ledger,
      guardrailState: config.guardrailState,
      guardrailStateStore: config.guardrailStateStore ?? null,
      routingConfig: this._routingConfig,
      riskScoringConfig: config.riskScoringConfig,
      competenceTracker: config.competenceTracker ?? null,
      trustAdapter: config.trustAdapter ?? null,
      riskPostureStore: config.riskPostureStore ?? null,
      governanceProfileStore: config.governanceProfileStore ?? null,
      policyCache: config.policyCache ?? null,
      executionMode: config.executionMode ?? "inline",
      onEnqueue: config.onEnqueue ?? null,
      approvalNotifier: config.approvalNotifier ?? null,
      selfApprovalAllowed: config.selfApprovalAllowed ?? false,
      approvalRateLimit: config.approvalRateLimit ?? null,
      crossCartridgeEnricher: config.crossCartridgeEnricher ?? null,
      dataFlowExecutor: config.dataFlowExecutor ?? null,
      credentialResolver: config.credentialResolver ?? null,
      circuitBreaker: config.circuitBreaker ?? null,
      idempotencyGuard: config.idempotencyGuard ?? null,
    };

    this.proposePipeline = new ProposePipeline(ctx);
    this.approvalManager = new ApprovalManager(ctx);
    this.executionManager = new ExecutionManager(ctx, config.circuitBreaker ?? null);
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
    emergencyOverride?: boolean;
    idempotencyKey?: string;
  }): Promise<ProposeResult> {
    return this.proposePipeline.propose(params);
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
  ): Promise<{
    planDecision: "allow" | "deny" | "partial";
    results: ProposeResult[];
    explanation: string;
    planApprovalRequest?: ApprovalRequest;
    planEnvelope?: ActionEnvelope;
  }> {
    return this.proposePipeline.proposePlan(plan, proposals, (envelopeId) =>
      this.executionManager.executeApproved(envelopeId),
    );
  }

  async respondToPlanApproval(params: {
    approvalId: string;
    action: "approve" | "reject";
    respondedBy: string;
    bindingHash: string;
  }): Promise<{
    planEnvelope: ActionEnvelope;
    executionResults: ExecuteResult[];
  }> {
    return this.approvalManager.respondToPlanApproval(params, (envelopeId) =>
      this.executionManager.executeApproved(envelopeId),
    );
  }

  async respondToApproval(params: {
    approvalId: string;
    action: "approve" | "reject" | "patch";
    respondedBy: string;
    bindingHash: string;
    patchValue?: Record<string, unknown>;
    approvalHash?: string;
  }): Promise<ApprovalResponse> {
    return this.approvalManager.respondToApproval(params, (envelopeId) =>
      this.executionManager.executeApproved(envelopeId),
    );
  }

  async executePreApproved(params: {
    actionType: string;
    parameters: Record<string, unknown>;
    principalId: string;
    organizationId: string | null;
    cartridgeId: string;
    traceId: string;
    idempotencyKey?: string;
    workUnitId?: string;
  }): Promise<ExecuteResult> {
    return this.executionManager.executePreApproved(params);
  }

  async executeApproved(envelopeId: string): Promise<ExecuteResult> {
    return this.executionManager.executeApproved(envelopeId);
  }

  async executePlan(
    plan: import("@switchboard/schemas").DataFlowPlan,
    context: {
      principalId: string;
      organizationId?: string;
      traceId?: string;
    },
  ): Promise<import("../data-flow/executor.js").DataFlowExecutionResult> {
    return this.executionManager.executePlan(plan, context);
  }

  async requestUndo(envelopeId: string): Promise<ProposeResult> {
    return this.executionManager.requestUndo(envelopeId, this.proposePipeline);
  }

  async simulate(params: {
    actionType: string;
    parameters: Record<string, unknown>;
    principalId: string;
    cartridgeId: string;
    organizationId?: string | null;
  }): Promise<SimulationResult> {
    return this.proposePipeline.simulate(params);
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
    return this.proposePipeline.resolveAndPropose(params);
  }
}

/**
 * Infer cartridge ID from action type prefix by matching against
 * registered cartridge IDs. Falls back to null if no match found.
 * e.g. "ads.campaign.pause" -> matches cartridge "ads-spend" if its
 * manifest declares an action with that type.
 */
export function inferCartridgeId(
  actionType: string,
  registry?: import("../storage/interfaces.js").CartridgeRegistry,
): string | null {
  if (!registry) return null;

  const prefix = actionType.split(".")[0];
  if (!prefix) return null;

  for (const cartridgeId of registry.list()) {
    const cartridge = registry.get(cartridgeId);
    if (!cartridge) continue;

    // Match by manifest actions: check if cartridge declares this action type
    const manifest = cartridge.manifest;
    if (manifest.actions) {
      for (const action of manifest.actions) {
        if (actionType === action.actionType) return cartridgeId;
        // Also match by shared prefix (e.g. "ads." prefix)
        const actionPrefix = action.actionType.split(".")[0];
        if (actionPrefix && actionPrefix === prefix) return cartridgeId;
      }
    }
  }

  return null;
}
