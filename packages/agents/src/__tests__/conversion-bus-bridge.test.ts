import { describe, it, expect } from "vitest";
import { InMemoryConversionBus, type ConversionEvent } from "@switchboard/core";
import { ConversionBusBridge } from "../bridges/conversion-bus-bridge.js";
import type { RoutedEventEnvelope } from "../events.js";

function makeConversionEvent(overrides: Partial<ConversionEvent> = {}): ConversionEvent {
  return {
    type: "inquiry",
    contactId: "contact-1",
    organizationId: "org-1",
    value: 0,
    timestamp: new Date("2026-03-18T12:00:00Z"),
    metadata: {},
    ...overrides,
  };
}

describe("ConversionBusBridge", () => {
  it("converts a ConversionEvent to a RoutedEventEnvelope and calls onEvent", () => {
    const bus = new InMemoryConversionBus();
    const received: RoutedEventEnvelope[] = [];
    const bridge = new ConversionBusBridge({
      onEvent: (env) => received.push(env),
    });
    bridge.register(bus);

    bus.emit(
      makeConversionEvent({
        type: "inquiry",
        contactId: "c-42",
        organizationId: "org-7",
        value: 100,
      }),
    );

    expect(received).toHaveLength(1);
    const envelope = received[0]!;
    expect(envelope.eventType).toBe("lead.received");
    expect(envelope.organizationId).toBe("org-7");
    expect(envelope.source).toEqual({ type: "system", id: "conversion-bus-bridge" });
    expect(envelope.eventId).toBeTruthy();
    expect(envelope.occurredAt).toBeTruthy();
    expect(envelope.payload).toEqual({
      contactId: "c-42",
      value: 100,
      originalType: "inquiry",
    });
  });

  it("maps all ConversionEventType values to the correct agent event types", () => {
    const bus = new InMemoryConversionBus();
    const received: RoutedEventEnvelope[] = [];
    const bridge = new ConversionBusBridge({
      onEvent: (env) => received.push(env),
    });
    bridge.register(bus);

    const mappings: Array<[ConversionEvent["type"], string]> = [
      ["inquiry", "lead.received"],
      ["qualified", "lead.qualified"],
      ["booked", "stage.advanced"],
      ["purchased", "revenue.recorded"],
      ["completed", "revenue.recorded"],
    ];

    for (const [convType, _expected] of mappings) {
      bus.emit(makeConversionEvent({ type: convType }));
    }

    expect(received).toHaveLength(mappings.length);
    for (let i = 0; i < mappings.length; i++) {
      expect(received[i]!.eventType).toBe(mappings[i]![1]);
    }
  });

  it("carries attribution chain from conversion event", () => {
    const bus = new InMemoryConversionBus();
    const received: RoutedEventEnvelope[] = [];
    const bridge = new ConversionBusBridge({
      onEvent: (env) => received.push(env),
    });
    bridge.register(bus);

    bus.emit(
      makeConversionEvent({
        type: "purchased",
        sourceAdId: "ad-99",
        sourceCampaignId: "camp-55",
        metadata: { fbclid: "fb-click-abc" },
      }),
    );

    expect(received).toHaveLength(1);
    const attr = received[0]!.attribution;
    expect(attr).toBeDefined();
    expect(attr!.sourceAdId).toBe("ad-99");
    expect(attr!.sourceCampaignId).toBe("camp-55");
    expect(attr!.fbclid).toBe("fb-click-abc");
    expect(attr!.gclid).toBeNull();
    expect(attr!.ttclid).toBeNull();
  });

  it("sets null for attribution fields when not provided", () => {
    const bus = new InMemoryConversionBus();
    const received: RoutedEventEnvelope[] = [];
    const bridge = new ConversionBusBridge({
      onEvent: (env) => received.push(env),
    });
    bridge.register(bus);

    bus.emit(makeConversionEvent({ type: "inquiry", metadata: {} }));

    expect(received).toHaveLength(1);
    const attr = received[0]!.attribution;
    expect(attr).toBeDefined();
    expect(attr!.sourceAdId).toBeNull();
    expect(attr!.sourceCampaignId).toBeNull();
    expect(attr!.fbclid).toBeNull();
  });
});
