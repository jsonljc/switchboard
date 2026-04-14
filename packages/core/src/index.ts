// ---------------------------------------------------------------------------
// @switchboard/core — public API surface
//
// Domain barrels provide sub-path imports (e.g. @switchboard/core/engine).
// This root barrel re-exports everything for backwards-compatible imports.
// ---------------------------------------------------------------------------

// Engine (rule evaluation, risk scoring, policy engine, simulation)
export * from "./engine/index.js";

// Identity (spec resolution, overlays, principals, governance presets)
export * from "./identity/index.js";

// Approval (state machine, routing, binding, expiry, delegation, patching, chains)
export * from "./approval/index.js";

// Storage (in-memory stores, interfaces)
export * from "./storage/index.js";

// Orchestrator (lifecycle, propose pipeline, approval/execution managers)
export { LifecycleOrchestrator, inferCartridgeId } from "./orchestrator/index.js";
export type {
  OrchestratorConfig,
  ProposeResult,
  ApprovalResponse,
  RuntimeOrchestrator,
} from "./orchestrator/index.js";
export { CartridgeCircuitBreakerWrapper } from "./orchestrator/circuit-breaker-wrapper.js";

// Audit (hashing, canonicalization, redaction, evidence, ledger)
export * from "./audit/index.js";

// Competence (tracker, thresholds)
export * from "./competence/index.js";

// Telemetry (tracing, metrics, LLM cost table)
export * from "./telemetry/index.js";

// Execution Guard
export { GuardedCartridge, beginExecution, endExecution } from "./execution-guard.js";

// Notifications (approval notifiers, proactive sender)
export * from "./notifications/index.js";

// Guardrail State Store
export * from "./guardrail-state/index.js";

// Runtime Adapters (MCP, API)
export * from "./runtime-adapters/index.js";

// Execution Service (propose + conditional execute facade)
export { ExecutionService, NeedsClarificationError, NotFoundError } from "./execution-service.js";

// CartridgeReadAdapter (governed read path)
export { CartridgeReadAdapter } from "./read-adapter.js";
export type { ReadOperation, ReadResult } from "./read-adapter.js";

// Governance (per-org posture)
export {
  profileToPosture,
  checkActionTypeRestriction,
  DEFAULT_GOVERNANCE_PROFILE,
  InMemoryGovernanceProfileStore,
} from "./governance/profile.js";
export type { GovernanceProfileStore } from "./governance/profile.js";

// Policy Cache
export { InMemoryPolicyCache, DEFAULT_POLICY_CACHE_TTL_MS } from "./policy-cache.js";
export type { PolicyCache } from "./policy-cache.js";

// Utilities (retry, circuit breaker, pagination, nested value)
export * from "./utils/index.js";

// Cross-Cartridge Enrichment
export * from "./enrichment/index.js";

// Data-Flow Plan Execution
export * from "./data-flow/index.js";

// Capability Registry
export * from "./capability/index.js";

// Planning (goal parsing, plan graph building)
export * from "./planning/index.js";

// Idempotency Guard
export { IdempotencyGuard, InMemoryIdempotencyStore } from "./idempotency/guard.js";
export type { IdempotencyStore } from "./idempotency/guard.js";

// Credential Resolution
export { NoOpCredentialResolver } from "./credentials/resolver.js";
export type { ConnectionCredentialResolver } from "./credentials/resolver.js";

// Tool Registry
export * from "./tool-registry/index.js";

// Event Bus (conversion feedback loop)
export { InMemoryConversionBus } from "./events/conversion-bus.js";
export type {
  ConversionBus,
  ConversionEvent,
  ConversionEventType,
  ConversionEventHandler,
} from "./events/conversion-bus.js";

// LLM Client Interface
export { MockLLMClient } from "./llm/types.js";
export type { LLMClient, LLMMessage, LLMCompletionOptions, SchemaValidator } from "./llm/types.js";

// State Machine (generic)
export { StateMachine } from "./state-machine/machine.js";
export type {
  StateMachineConfig,
  Transition,
  TransitionResult,
  TransitionGuard,
  StateCallback,
} from "./state-machine/types.js";

// Dialogue (emotional classification, naturalness, bilingual, post-validation)
export { classifyEmotionalSignal } from "./dialogue/emotional-classifier.js";
export { NaturalnessPacketAssembler } from "./dialogue/naturalness-assembler.js";
export { buildLocalisedSystemPrompt } from "./dialogue/system-prompt-builder.js";
export { VariationPool } from "./dialogue/variation-pool.js";
export { detectLanguage } from "./dialogue/language-detector.js";
export { resolveLanguage, getLocalizedContent } from "./dialogue/bilingual-handler.js";
export { PostGenerationValidator } from "./dialogue/post-validator.js";
export type {
  PrimaryMove,
  EmotionalSignal,
  EmotionalSignalInput,
  NaturalnessPacket,
  VoiceConfig,
  ResponseConstraints,
  VariationControl,
} from "./dialogue/types.js";
export type { DetectedLanguage, LanguageDetectionResult } from "./dialogue/language-detector.js";
export type {
  ValidationResult as PostValidationResult,
  Violation,
} from "./dialogue/post-validator.js";

// Handoff (human handoff package assembly)
export { HandoffPackageAssembler } from "./handoff/package-assembler.js";
export { HandoffNotifier } from "./handoff/handoff-notifier.js";
export { SlaMonitor } from "./handoff/sla-monitor.js";
export type {
  HandoffPackage,
  HandoffReason,
  HandoffStatus,
  HandoffStore,
  LeadSnapshot,
  QualificationSnapshot,
  ConversationSummary,
} from "./handoff/types.js";

// Embedding Adapter
export type { EmbeddingAdapter } from "./embedding-adapter.js";

// Conversation Store
export type {
  ConversationStore,
  Message,
  LifecycleStage as ConversationLifecycleStage,
} from "./conversation-store.js";

// Conversation Thread (per-contact derived state)
export * from "./conversations/index.js";

// Knowledge Store (RAG chunk persistence)
export type {
  KnowledgeStore,
  KnowledgeChunk,
  KnowledgeSourceType,
  KnowledgeSearchOptions,
  RetrievalResult,
} from "./knowledge-store.js";

// LLM Adapter (conversational, agent-facing)
export type { LLMAdapter, ConversationPrompt, LLMReply, RetrievedChunk } from "./llm-adapter.js";

// Model Router (slot-based model selection)
export { ModelRouter } from "./model-router.js";
export type { ModelSlot, ModelConfig, ResolveOptions, TierContext } from "./model-router.js";

// Sessions (session runtime)
export * from "./sessions/index.js";

// Workflows (workflow execution runtime)
export * from "./workflows/index.js";

// Scheduler (trigger registration, state machine, event matching)
export * from "./scheduler/index.js";

// Operator Command Store
export * from "./operator/index.js";

// Lifecycle (Contact, Opportunity, Revenue, OwnerTask)
export * from "./lifecycle/index.js";

// Marketplace (Trust Score Engine)
export * from "./marketplace/index.js";

// Channel Gateway (channel → AgentRuntime bridge)
export * from "./channel-gateway/index.js";

// Website Scanner (URL validation, platform detection, page fetching)
export { WebsiteScanner, validateScanUrl, detectPlatform } from "./website-scanner/index.js";

// Memory (scoped store interfaces for three-channel privacy)
export * from "./memory/index.js";
