// ---------------------------------------------------------------------------
// @switchboard/agents — Agent infrastructure for the closed-loop funnel
// ---------------------------------------------------------------------------

export {
  AGENT_EVENT_TYPES,
  createEventEnvelope,
  type AgentEventType,
  type AttributionChain,
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
  type PortValidationResult,
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

export { createWebhookHandler, type WebhookHandlerConfig } from "./dispatch/webhook-handler.js";

export {
  InMemoryWebhookConfigProvider,
  type WebhookConfigEntry,
} from "./providers/webhook-config-provider.js";

export {
  ConversionBusBridge,
  type ConversionBusBridgeOptions,
} from "./bridges/conversion-bus-bridge.js";

export {
  validateConnectorConfig,
  type ConnectorAdapter,
  type ConnectorConfigValidation,
  type ConnectorPort,
} from "./connectors/connector-port.js";

export {
  createConnectorHandler,
  type ConnectorHandlerConfig,
} from "./dispatch/connector-handler.js";

export { InMemoryConnectorConfigProvider } from "./providers/connector-config-provider.js";

export { HubSpotConnectorAdapter } from "./connectors/hubspot-adapter.js";

export {
  LEAD_RESPONDER_PORT,
  LeadResponderHandler,
  type LeadResponderDeps,
  type LeadResponderConversationDeps,
  type FAQMatch,
  type LeadScore,
  type ObjectionMatch,
  type TonePreset,
  type SupportedLanguage,
} from "./agents/lead-responder/index.js";

export {
  SALES_CLOSER_PORT,
  SalesCloserHandler,
  type SalesCloserDeps,
  type SalesCloserConversationDeps,
} from "./agents/sales-closer/index.js";

export {
  AgentStateTracker,
  type ActivityStatus,
  type AgentActivityState,
  type StateChangeListener,
} from "./agent-state.js";

export {
  NURTURE_AGENT_PORT,
  NurtureAgentHandler,
  type NurtureDeps,
} from "./agents/nurture/index.js";

export {
  AD_OPTIMIZER_PORT,
  AdOptimizerHandler,
  type AdOptimizerDeps,
} from "./agents/ad-optimizer/index.js";

export {
  REVENUE_TRACKER_PORT,
  RevenueTrackerHandler,
  type RevenueTrackerDeps,
} from "./agents/revenue-tracker/index.js";

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

export {
  canRequalify,
  agentForStage,
  agentForThreadStage,
  type LifecycleStage,
} from "./lifecycle.js";

export {
  ConversationRouter,
  type ConversationRouterConfig,
  type StageResolver,
} from "./conversation-router.js";

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
