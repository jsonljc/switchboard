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

export {
  Dispatcher,
  type DestinationHandler,
  type DispatcherConfig,
  type DispatchResult,
} from "./dispatcher.js";

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
  type LeadScore,
  type ObjectionMatch,
} from "./agents/lead-responder/index.js";
