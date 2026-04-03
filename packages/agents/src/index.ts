// ---------------------------------------------------------------------------
// @switchboard/agents — Agent infrastructure for the AI workforce platform
// ---------------------------------------------------------------------------

export {
  AGENT_EVENT_TYPES,
  createEventEnvelope,
  type AgentEventType,
  type CreateEnvelopeInput,
  type EventSource,
  type RoutedEventEnvelope,
} from "./events.js";

export {
  validateAgentPort,
  type ActionRequest,
  type AgentContext,
  type AgentHandler,
  type AgentPort,
  type AgentResponse,
  type LifecycleAdvancer,
  type PortValidationResult,
  type ThreadUpdate,
  type ToolDeclaration,
} from "./ports.js";

export {
  AgentRegistry,
  type AgentHealth,
  type AgentRegistryEntry,
  type AgentRuntime,
  type AgentStatus,
  type ExecutionMode,
} from "./registry.js";

export {
  PolicyBridge,
  type DeliveryIntent,
  type PolicyEngine,
  type PolicyEvaluation,
} from "./policy-bridge.js";

export {
  DEFAULT_MAX_RETRIES,
  InMemoryDeliveryStore,
  type DeliveryAttempt,
  type DeliveryStatus,
  type DeliveryStore,
} from "./delivery-store.js";

export {
  type ConnectorDestinationConfig,
  type DestinationCriticality,
  type DestinationSequencing,
  type DestinationType,
  type ManualQueueReason,
  type ResolvedDestination,
  type RoutePlan,
  type WebhookDestinationConfig,
} from "./route-plan.js";

export { AgentRouter, type AgentRouterConfig } from "./router.js";

export { HandlerRegistry } from "./handler-registry.js";

export { ActionExecutor, type ActionHandler, type ActionResult } from "./action-executor.js";

export {
  EventLoop,
  type EventLoopConfig,
  type EventLoopResult,
  type ProcessedAgent,
} from "./event-loop.js";

export {
  ScheduledRunner,
  type ScheduledRunnerConfig,
  type ScheduledRunResult,
} from "./scheduled-runner.js";

export { validatePayload, PayloadValidationError } from "./validate-payload.js";

export {
  CorePolicyEngineAdapter,
  type CoreDecisionResult,
  type CoreEvaluateFn,
  type CorePolicyEngineAdapterConfig,
} from "./core-policy-adapter.js";

export {
  RetryExecutor,
  type RetryExecutorConfig,
  type RetryFn,
  type RetryResult,
} from "./retry-executor.js";

export {
  DeadLetterAlerter,
  type DeadLetterAlerterConfig,
  type SweepResult,
} from "./dead-letter-alerter.js";

// Concurrency & Safety
export {
  ContactMutex,
  LoopDetector,
  type ContactMutexConfig,
  type LoopDetectorConfig,
} from "./concurrency.js";

// Escalation
export {
  EscalationService,
  type EscalateInput,
  type EscalateResult,
  type EscalationNotifier,
  type EscalationPriority,
  type EscalationReason,
  type EscalationRecord,
  type EscalationServiceConfig,
  type EscalationStatus,
  type EscalationStore,
} from "./escalation.js";

// LLM Adapters (Claude implementations)
export {
  ClaudeLLMAdapter,
  ClaudeEmbeddingAdapter,
  type ClaudeLLMAdapterConfig,
  type LLMCompleteFn,
  type ClaudeEmbeddingAdapterConfig,
  type EmbeddingClient,
} from "./llm/index.js";

// Knowledge (RAG infrastructure)
export {
  chunkText,
  IngestionPipeline,
  KnowledgeRetriever,
  computeConfidence,
  type ChunkOptions,
  type TextChunk,
  type IngestionInput,
  type IngestionResult,
  type IngestionPipelineConfig,
  type RetrievalConfig,
  type RetrieveOptions,
  type ConfidenceInput,
} from "./knowledge/index.js";
