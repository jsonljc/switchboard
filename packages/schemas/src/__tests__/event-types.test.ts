import { describe, it, expect } from "vitest";
import { createEventEnvelope } from "../event-types.js";
import type { RoutedEventEnvelope, EventSource } from "../event-types.js";

describe("Event types", () => {
  it("creates an event envelope with defaults", () => {
    const envelope = createEventEnvelope({
      eventType: "content.requested",
      organizationId: "org-1",
      source: { type: "manual", id: "user-1" },
      payload: { topic: "AI trends" },
    });
    expect(envelope.eventId).toBeDefined();
    expect(envelope.eventType).toBe("content.requested");
    expect(envelope.correlationId).toBeDefined();
    expect(envelope.idempotencyKey).toBeDefined();
    expect(envelope.occurredAt).toBeDefined();
  });

  it("creates an event envelope with explicit correlationId", () => {
    const envelope = createEventEnvelope({
      eventType: "test.event",
      organizationId: "org-1",
      source: { type: "system", id: "scheduler" },
      payload: {},
      correlationId: "corr-123",
      causationId: "cause-456",
      idempotencyKey: "idem-789",
    });
    expect(envelope.correlationId).toBe("corr-123");
    expect(envelope.causationId).toBe("cause-456");
    expect(envelope.idempotencyKey).toBe("idem-789");
  });

  it("EventSource type is structurally valid", () => {
    const sources: EventSource[] = [
      { type: "agent", id: "employee-a" },
      { type: "connector", id: "hubspot" },
      { type: "webhook", id: "stripe" },
      { type: "manual", id: "user-1" },
      { type: "system", id: "scheduler" },
    ];
    expect(sources).toHaveLength(5);
  });

  it("RoutedEventEnvelope accepts metadata", () => {
    const envelope: RoutedEventEnvelope = {
      eventId: "evt-1",
      organizationId: "org-1",
      eventType: "test",
      occurredAt: new Date().toISOString(),
      source: { type: "manual", id: "user-1" },
      correlationId: "corr-1",
      idempotencyKey: "idem-1",
      payload: {},
      metadata: { retryCount: 3 },
    };
    expect(envelope.metadata).toEqual({ retryCount: 3 });
  });
});
