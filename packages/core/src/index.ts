// Engine
export { evaluateRule } from "./engine/rule-evaluator.js";
export type { EvaluationContext, ConditionResult, RuleResult } from "./engine/rule-evaluator.js";
export { computeRiskScore, DEFAULT_RISK_CONFIG, computeCompositeRiskAdjustment, DEFAULT_COMPOSITE_RISK_CONFIG } from "./engine/risk-scorer.js";
export type { RiskScoringConfig, CompositeRiskConfig } from "./engine/risk-scorer.js";
export { createTraceBuilder, addCheck, buildTrace } from "./engine/decision-trace.js";
export type { DecisionTraceBuilder } from "./engine/decision-trace.js";
export { resolveEntities, buildClarificationQuestion, buildNotFoundExplanation } from "./engine/resolver.js";
export type { EntityResolver, ResolverResult } from "./engine/resolver.js";
export { evaluatePlan } from "./engine/composites.js";
export type { PlanEvaluationResult } from "./engine/composites.js";
export { formatSimulationResult } from "./engine/simulator.js";
export type { SimulationInput, SimulationResult } from "./engine/simulator.js";
export { evaluate, simulate, createGuardrailState } from "./engine/policy-engine.js";
export type { PolicyEngineConfig, PolicyEngineContext, GuardrailState, SpendLookup } from "./engine/policy-engine.js";
export { InMemoryRiskPostureStore } from "./engine/risk-posture.js";
export type { RiskPostureStore } from "./engine/risk-posture.js";

// Identity
export { resolveIdentity, applyCompetenceAdjustments } from "./identity/spec.js";
export type { ResolvedIdentity } from "./identity/spec.js";
export { getActiveOverlays } from "./identity/overlay.js";
export { canActAs, resolveApprovers } from "./identity/principals.js";
export { GOVERNANCE_PROFILE_PRESETS } from "./identity/governance-presets.js";
export type { GovernanceProfilePreset } from "./identity/governance-presets.js";

// Approval
export {
  createApprovalState,
  transitionApproval,
  isExpired,
  determineApprovalRequirement,
  StaleVersionError,
} from "./approval/state-machine.js";
export type { ApprovalState, ApprovalStatus, QuorumState, QuorumEntry } from "./approval/state-machine.js";
export { routeApproval, DEFAULT_ROUTING_CONFIG } from "./approval/router.js";
export type { ApprovalRouting, ApprovalRoutingConfig } from "./approval/router.js";
export { computeBindingHash, hashObject, validateBindingHash } from "./approval/binding.js";
export { checkExpiry, getExpiryMs } from "./approval/expiry.js";
export { canApprove, canApproveWithChain } from "./approval/delegation.js";
export { applyPatch, describePatch } from "./approval/patching.js";
export { resolveDelegationChain, narrowScope } from "./approval/chain.js";
export type { DelegationChainResult, ChainResolutionOptions } from "./approval/chain.js";

// Storage
export {
  InMemoryEnvelopeStore,
  InMemoryPolicyStore,
  InMemoryIdentityStore,
  InMemoryApprovalStore,
  InMemoryCartridgeRegistry,
  InMemoryCompetenceStore,
  matchActionTypePattern,
  createInMemoryStorage,
  seedDefaultStorage,
} from "./storage/index.js";
export type {
  EnvelopeStore,
  PolicyStore,
  IdentityStore,
  ApprovalStore,
  CartridgeRegistry,
  CompetenceStore,
  StorageContext,
} from "./storage/index.js";

// Orchestrator
export { LifecycleOrchestrator, inferCartridgeId } from "./orchestrator/index.js";
export type { OrchestratorConfig, ProposeResult, ApprovalResponse, RuntimeOrchestrator } from "./orchestrator/index.js";

// Audit
export { computeAuditHash, computeAuditHashSync, sha256, verifyChain } from "./audit/canonical-hash.js";
export { canonicalizeSync } from "./audit/canonical-json.js";
export type { AuditHashInput } from "./audit/canonical-hash.js";
export { redactSnapshot, DEFAULT_REDACTION_CONFIG } from "./audit/redaction.js";
export type { RedactionConfig, RedactionResult } from "./audit/redaction.js";
export { storeEvidence, verifyEvidence, setEvidenceStore, InMemoryEvidenceStore, FileSystemEvidenceStore } from "./audit/evidence.js";
export type { EvidencePointer, EvidenceStore } from "./audit/evidence.js";
export { AuditLedger, InMemoryLedgerStorage } from "./audit/ledger.js";
export type { LedgerStorage, AuditQueryFilter } from "./audit/ledger.js";

// Competence
export { CompetenceTracker, DEFAULT_COMPETENCE_THRESHOLDS } from "./competence/index.js";

// Telemetry
export { getTracer, setTracer, createOTelTracer, NoopTracer } from "./telemetry/index.js";
export type { Tracer, Span } from "./telemetry/index.js";
export { getMetrics, setMetrics, createInMemoryMetrics } from "./telemetry/index.js";
export type { SwitchboardMetrics, Counter, Histogram } from "./telemetry/index.js";

// LLM Cost Table
export {
  LLM_COST_TABLE,
  DEFAULT_MODEL_ID,
  computeTokenCostUSD,
  usdToTokenBudget,
  getModelCost,
  listModelCosts,
} from "./telemetry/llm-costs.js";
export type { ModelCostEntry } from "./telemetry/llm-costs.js";

// Execution Guard
export { GuardedCartridge, beginExecution, endExecution } from "./execution-guard.js";

// Notifications
export { NoopNotifier, CompositeNotifier, buildApprovalNotification } from "./notifications/index.js";
export type { ApprovalNotifier, ApprovalNotification } from "./notifications/index.js";

// Guardrail State Store
export type { GuardrailStateStore, RateLimitEntry } from "./guardrail-state/index.js";
export { InMemoryGuardrailStateStore } from "./guardrail-state/index.js";

// Runtime Adapters (execute request/response for OpenClaw, MCP, etc.)
export type {
  RuntimeExecuteRequest,
  RuntimeExecuteResponse,
  ExecuteOutcome,
  RuntimeAdapter,
} from "./runtime-adapters/types.js";

// Execution service (single propose + conditional execute facade)
export { ExecutionService, NeedsClarificationError, NotFoundError } from "./execution-service.js";

// OpenClaw adapter (tool payload ↔ RuntimeExecuteRequest/Response)
export {
  openclawPayloadToRequest,
  responseToOpenclawTool,
  openclawExecute,
} from "./runtime-adapters/openclaw.js";
export type { OpenClawToolPayload, OpenClawToolResponse } from "./runtime-adapters/openclaw.js";

// MCP adapter (tool payload ↔ RuntimeExecuteRequest/Response)
export {
  mcpToolCallToExecuteRequest,
  executeResponseToMcpResult,
  mcpExecute,
} from "./runtime-adapters/mcp.js";
export type { McpToolCallPayload, McpToolResponse } from "./runtime-adapters/mcp.js";

// CartridgeReadAdapter (governed read path for cartridge provider methods)
export { CartridgeReadAdapter } from "./read-adapter.js";
export type { ReadOperation, ReadResult } from "./read-adapter.js";

// HTTP adapter (call POST /api/execute from another process)
export { HttpExecutionAdapter } from "./runtime-adapters/http-adapter.js";
export type { HttpExecutionAdapterOptions } from "./runtime-adapters/http-adapter.js";

// Integration guide generator
export { generateIntegrationGuide } from "./runtime-adapters/integration-guide.js";
export type { IntegrationGuide, IntegrationStep, IntegrationGuideParams } from "./runtime-adapters/integration-guide.js";

// Governance profiles (per-org posture)
export {
  profileToPosture,
  checkActionTypeRestriction,
  DEFAULT_GOVERNANCE_PROFILE,
  InMemoryGovernanceProfileStore,
} from "./governance/profile.js";
export type { GovernanceProfileStore } from "./governance/profile.js";

// Policy cache
export { InMemoryPolicyCache, DEFAULT_POLICY_CACHE_TTL_MS } from "./policy-cache.js";
export type { PolicyCache } from "./policy-cache.js";

// Retry utility
export { withRetry } from "./utils/retry.js";
export type { RetryOptions } from "./utils/retry.js";

// Circuit breaker
export { CircuitBreaker, CircuitBreakerOpenError } from "./utils/circuit-breaker.js";
export type { CircuitBreakerConfig, CircuitBreakerState } from "./utils/circuit-breaker.js";

// Pagination
export { paginationParams, paginate } from "./utils/pagination.js";
export type { PaginatedResult, PaginationParams } from "./utils/pagination.js";

// Entity Graph (cross-cartridge entity resolution)
export { EntityGraphService, InMemoryEntityMappingStore } from "./entity-graph/index.js";
export type { EntityMappingStore, EntityRef, EntityMapping, CrossCartridgeEntityResolution } from "./entity-graph/index.js";

// Cross-Cartridge Enrichment
export { DefaultCrossCartridgeEnricher, DEFAULT_ENRICHMENT_MAPPINGS } from "./enrichment/index.js";
export type { CrossCartridgeContext, EnrichmentMapping, CrossCartridgeEnricher, DefaultCrossCartridgeEnricherConfig } from "./enrichment/index.js";

// Event Bus (cross-cartridge event-driven reactions)
export { InMemoryEventBus, InMemoryEventReactionStore, EventReactionProcessor, resolveTemplate } from "./event-bus/index.js";
export type { DomainEvent, EventReaction, EventBus, EventSubscription, EventReactionStore, ReactionOrchestrator, EventReactionProcessorConfig } from "./event-bus/index.js";

// Data-Flow Plan Execution (multi-step cross-cartridge plans with binding resolution)
export { DataFlowExecutor, resolveBindings, BindingResolutionError, evaluateCondition } from "./data-flow/index.js";
export type { DataFlowStep, DataFlowPlan, StepExecutionResult, DataFlowOrchestrator, DataFlowExecutorConfig, DataFlowExecutionResult, BindingContext } from "./data-flow/index.js";

// SMB governance (simplified pipeline for SMB-tier organizations)
export {
  smbEvaluate,
  smbCategorizeRisk,
  smbApprovalRequired,
  smbRouteApproval,
  smbBindingHash,
  smbCreateApprovalRequest,
  SmbActivityLog,
  InMemorySmbActivityLogStorage,
  smbPropose,
  InMemoryTierStore,
} from "./smb/index.js";
export type {
  SmbEvaluationContext,
  SmbApprovalRouting,
  ActivityLogEntry,
  ActivityLogQuery,
  ActivityLogStorage,
  ActivityResult,
  SmbPipelineContext,
  TierStore,
} from "./smb/index.js";
