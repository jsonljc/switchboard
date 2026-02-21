// Engine
export { evaluateRule } from "./engine/rule-evaluator.js";
export type { EvaluationContext, ConditionResult, RuleResult } from "./engine/rule-evaluator.js";
export { computeRiskScore, DEFAULT_RISK_CONFIG } from "./engine/risk-scorer.js";
export type { RiskScoringConfig } from "./engine/risk-scorer.js";
export { createTraceBuilder, addCheck, buildTrace } from "./engine/decision-trace.js";
export type { DecisionTraceBuilder } from "./engine/decision-trace.js";
export { resolveEntities, buildClarificationQuestion, buildNotFoundExplanation } from "./engine/resolver.js";
export type { EntityResolver, ResolverResult } from "./engine/resolver.js";
export { evaluatePlan } from "./engine/composites.js";
export type { PlanEvaluationResult } from "./engine/composites.js";
export { formatSimulationResult } from "./engine/simulator.js";
export type { SimulationInput, SimulationResult } from "./engine/simulator.js";
export { evaluate, simulate, createGuardrailState } from "./engine/policy-engine.js";
export type { PolicyEngineConfig, PolicyEngineContext, GuardrailState } from "./engine/policy-engine.js";

// Identity
export { resolveIdentity } from "./identity/spec.js";
export type { ResolvedIdentity } from "./identity/spec.js";
export { getActiveOverlays } from "./identity/overlay.js";
export { canActAs, resolveApprovers } from "./identity/principals.js";

// Approval
export {
  createApprovalState,
  transitionApproval,
  isExpired,
  determineApprovalRequirement,
} from "./approval/state-machine.js";
export type { ApprovalState, ApprovalStatus } from "./approval/state-machine.js";
export { routeApproval, DEFAULT_ROUTING_CONFIG } from "./approval/router.js";
export type { ApprovalRouting, ApprovalRoutingConfig } from "./approval/router.js";
export { computeBindingHash, hashObject, validateBindingHash } from "./approval/binding.js";
export { checkExpiry, getExpiryMs } from "./approval/expiry.js";
export { canApprove } from "./approval/delegation.js";
export { applyPatch, describePatch } from "./approval/patching.js";

// Storage
export {
  InMemoryEnvelopeStore,
  InMemoryPolicyStore,
  InMemoryIdentityStore,
  InMemoryApprovalStore,
  InMemoryCartridgeRegistry,
  createInMemoryStorage,
} from "./storage/index.js";
export type {
  EnvelopeStore,
  PolicyStore,
  IdentityStore,
  ApprovalStore,
  CartridgeRegistry,
  StorageContext,
} from "./storage/index.js";

// Orchestrator
export { LifecycleOrchestrator } from "./orchestrator/index.js";
export type { OrchestratorConfig, ProposeResult, ApprovalResponse } from "./orchestrator/index.js";

// Audit
export { computeAuditHash, computeAuditHashSync, sha256, verifyChain } from "./audit/canonical-hash.js";
export type { AuditHashInput } from "./audit/canonical-hash.js";
export { redactSnapshot, DEFAULT_REDACTION_CONFIG } from "./audit/redaction.js";
export type { RedactionConfig, RedactionResult } from "./audit/redaction.js";
export { storeEvidence, verifyEvidence } from "./audit/evidence.js";
export type { EvidencePointer } from "./audit/evidence.js";
export { AuditLedger, InMemoryLedgerStorage } from "./audit/ledger.js";
export type { LedgerStorage, AuditQueryFilter } from "./audit/ledger.js";
