// ---------------------------------------------------------------------------
// Event Types — shared event envelope definitions
// ---------------------------------------------------------------------------

import type { AttributionChain } from "./lifecycle.js";

const uuid = (): string => {
  // TS 6 tightened globalThis access; assert through unknown then index.
  const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
  const c = g.crypto;
  return typeof c?.randomUUID === "function"
    ? c.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

export interface EventSource {
  type: "agent" | "connector" | "webhook" | "manual" | "system";
  id: string;
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
  const eventId = uuid();
  return {
    eventId,
    organizationId: input.organizationId,
    eventType: input.eventType,
    occurredAt: new Date().toISOString(),
    source: input.source,
    correlationId: input.correlationId ?? uuid(),
    causationId: input.causationId,
    idempotencyKey: input.idempotencyKey ?? eventId,
    attribution: input.attribution,
    payload: input.payload,
    metadata: input.metadata,
  };
}
