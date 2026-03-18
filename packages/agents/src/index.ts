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
} from "./registry.js";

export {
  PolicyBridge,
  type DeliveryIntent,
  type PolicyEngine,
  type PolicyEvaluation,
} from "./policy-bridge.js";

export {
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
