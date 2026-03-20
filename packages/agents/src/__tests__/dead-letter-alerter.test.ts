import { describe, it, expect, vi, beforeEach } from "vitest";
import { DeadLetterAlerter } from "../dead-letter-alerter.js";
import { InMemoryDeliveryStore } from "../delivery-store.js";
import type { RoutedEventEnvelope } from "../events.js";

describe("DeadLetterAlerter", () => {
  let store: InMemoryDeliveryStore;
  let emittedEvents: RoutedEventEnvelope[];
  let alerter: DeadLetterAlerter;

  beforeEach(() => {
    store = new InMemoryDeliveryStore();
    emittedEvents = [];
    alerter = new DeadLetterAlerter({
      store,
      onEscalation: (event) => {
        emittedEvents.push(event);
      },
      maxRetries: 3,
    });
  });

  it("sweeps dead letters and emits escalation events", async () => {
    await store.record({
      eventId: "evt-1",
      destinationId: "agent-1",
      status: "failed",
      attempts: 3,
      error: "handler crash",
    });
    await store.record({
      eventId: "evt-2",
      destinationId: "agent-2",
      status: "retrying",
      attempts: 5,
      error: "timeout",
    });

    const result = await alerter.sweep("org-1");
    expect(result.deadLettered).toBe(2);
    expect(emittedEvents).toHaveLength(2);
  });

  it("sets correct escalation event fields", async () => {
    await store.record({
      eventId: "evt-1",
      destinationId: "agent-1",
      status: "failed",
      attempts: 3,
      error: "handler crash",
    });

    await alerter.sweep("org-1");

    const event = emittedEvents[0]!;
    expect(event.eventType).toBe("conversation.escalated");
    expect(event.organizationId).toBe("org-1");
    const payload = event.payload as Record<string, unknown>;
    expect(payload.reason).toBe("dead_letter");
    expect(payload.eventId).toBe("evt-1");
    expect(payload.destinationId).toBe("agent-1");
    expect(payload.error).toBe("handler crash");
  });

  it("emits nothing when no dead letters found", async () => {
    await store.record({
      eventId: "evt-1",
      destinationId: "agent-1",
      status: "failed",
      attempts: 1,
    });

    const result = await alerter.sweep("org-1");
    expect(result.deadLettered).toBe(0);
    expect(emittedEvents).toHaveLength(0);
  });

  it("logs dead letters to console.warn", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await store.record({
      eventId: "evt-1",
      destinationId: "agent-1",
      status: "failed",
      attempts: 3,
      error: "boom",
    });

    await alerter.sweep("org-1");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("[dead-letter]"));
    warnSpy.mockRestore();
  });
});
