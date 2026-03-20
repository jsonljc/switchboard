// ---------------------------------------------------------------------------
// Canonical Agent Events & RoutedEventEnvelope
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";

export const AGENT_EVENT_TYPES = [
  "lead.received",
  "lead.qualified",
  "lead.disqualified",
  "stage.advanced",
  "stage.reverted",
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

export interface EventSource {
  type: "agent" | "connector" | "webhook" | "manual" | "system";
  id: string;
}

export interface AttributionChain {
  fbclid: string | null;
  gclid: string | null;
  ttclid: string | null;
  sourceCampaignId: string | null;
  sourceAdId: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
}

export interface RoutedEventEnvelope<TPayload = unknown> {
  eventId: string;
  organizationId: string;
  eventType: string;
  occurredAt: string;
  source: EventSource;
  correlationId: string;
  causationId?: string;
  idempotencyKey: string;
  attribution?: AttributionChain;
  payload: TPayload;
  metadata?: Record<string, unknown>;
}

export interface CreateEnvelopeInput<TPayload = unknown> {
  organizationId: string;
  eventType: string;
  source: EventSource;
  payload: TPayload;
  correlationId?: string;
  causationId?: string;
  idempotencyKey?: string;
  attribution?: AttributionChain;
  metadata?: Record<string, unknown>;
}

export function createEventEnvelope<TPayload = unknown>(
  input: CreateEnvelopeInput<TPayload>,
): RoutedEventEnvelope<TPayload> {
  const eventId = randomUUID();
  return {
    eventId,
    organizationId: input.organizationId,
    eventType: input.eventType,
    occurredAt: new Date().toISOString(),
    source: input.source,
    correlationId: input.correlationId ?? randomUUID(),
    causationId: input.causationId,
    idempotencyKey: input.idempotencyKey ?? eventId,
    attribution: input.attribution,
    payload: input.payload,
    metadata: input.metadata,
  };
}
