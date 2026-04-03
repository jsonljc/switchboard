import { describe, it, expect } from "vitest";
import { createEventEnvelope } from "../event-types.js";
import type { RoutedEventEnvelope, EventSource } from "../event-types.js";
import { CREATIVE_EVENTS } from "../employee-events.js";
import type { CreativeEventType } from "../employee-events.js";

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
      { type: "agent", id: "lead-responder" },
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

describe("Employee events", () => {
  it("CREATIVE_EVENTS has expected event types", () => {
    expect(CREATIVE_EVENTS.CONTENT_REQUESTED).toBe("content.requested");
    expect(CREATIVE_EVENTS.CONTENT_DRAFT_READY).toBe("content.draft_ready");
    expect(CREATIVE_EVENTS.CONTENT_APPROVED).toBe("content.approved");
    expect(CREATIVE_EVENTS.CONTENT_REJECTED).toBe("content.rejected");
    expect(CREATIVE_EVENTS.CONTENT_PUBLISHED).toBe("content.published");
    expect(CREATIVE_EVENTS.EMPLOYEE_ONBOARDED).toBe("employee.onboarded");
  });

  it("CreativeEventType is a union of event values", () => {
    const eventType: CreativeEventType = "content.requested";
    expect(eventType).toBe("content.requested");
  });
});
