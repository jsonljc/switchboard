// ---------------------------------------------------------------------------
// Canonical Agent Events & RoutedEventEnvelope
// Re-exports from @switchboard/schemas for backwards compatibility
// ---------------------------------------------------------------------------

// Re-export event infrastructure from schemas (Layer 1)
export { createEventEnvelope } from "@switchboard/schemas";
export type { RoutedEventEnvelope, EventSource, CreateEnvelopeInput } from "@switchboard/schemas";

// Agent-specific event types stay here (domain knowledge, not shared infra)
export const AGENT_EVENT_TYPES = [
  "lead.received",
  "lead.qualified",
  "lead.disqualified",
  "stage.advanced",
  "stage.reverted",
  "opportunity.stage_advanced",
  "revenue.recorded",
  "revenue.attributed",
  "ad.optimized",
  "ad.anomaly_detected",
  "ad.performance_review",
  "conversation.escalated",
  "message.received",
  "message.sent",
  "escalation.owner_replied",
] as const;

export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];
