import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemoryConversionBus } from "../conversion-bus.js";
import type { ConversionEvent, ConversionEventHandler } from "../conversion-bus.js";

function makeEvent(overrides?: Partial<ConversionEvent>): ConversionEvent {
  return {
    eventId: "evt_test_1",
    type: "inquiry",
    contactId: "ct_1",
    organizationId: "org_1",
    value: 0,
    occurredAt: new Date(),
    source: "test",
    metadata: {},
    ...overrides,
  };
}

describe("InMemoryConversionBus", () => {
  let bus: InMemoryConversionBus;

  beforeEach(() => {
    bus = new InMemoryConversionBus();
  });

  describe("subscribe and emit", () => {
    it("delivers events to type-specific subscribers", () => {
      const handler = vi.fn();
      bus.subscribe("inquiry", handler);

      const event = makeEvent({ type: "inquiry" });
      bus.emit(event);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(event);
    });

    it("does not deliver events to subscribers of different types", () => {
      const handler = vi.fn();
      bus.subscribe("booked", handler);

      bus.emit(makeEvent({ type: "inquiry" }));

      expect(handler).not.toHaveBeenCalled();
    });

    it("delivers events to wildcard subscribers for all types", () => {
      const handler = vi.fn();
      bus.subscribe("*", handler);

      bus.emit(makeEvent({ type: "inquiry" }));
      bus.emit(makeEvent({ type: "qualified" }));
      bus.emit(makeEvent({ type: "booked" }));

      expect(handler).toHaveBeenCalledTimes(3);
    });

    it("delivers to both type-specific and wildcard subscribers", () => {
      const specific = vi.fn();
      const wildcard = vi.fn();
      bus.subscribe("booked", specific);
      bus.subscribe("*", wildcard);

      bus.emit(makeEvent({ type: "booked" }));

      expect(specific).toHaveBeenCalledTimes(1);
      expect(wildcard).toHaveBeenCalledTimes(1);
    });

    it("supports multiple subscribers for the same type", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      bus.subscribe("qualified", handler1);
      bus.subscribe("qualified", handler2);

      bus.emit(makeEvent({ type: "qualified" }));

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });
  });

  describe("unsubscribe", () => {
    it("stops delivering events after unsubscribe", () => {
      const handler = vi.fn();
      bus.subscribe("inquiry", handler);
      bus.unsubscribe("inquiry", handler);

      bus.emit(makeEvent({ type: "inquiry" }));

      expect(handler).not.toHaveBeenCalled();
    });

    it("only removes the specific handler", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      bus.subscribe("inquiry", handler1);
      bus.subscribe("inquiry", handler2);
      bus.unsubscribe("inquiry", handler1);

      bus.emit(makeEvent({ type: "inquiry" }));

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it("handles unsubscribe of non-existent handler gracefully", () => {
      const handler = vi.fn();
      // Should not throw
      bus.unsubscribe("inquiry", handler);
    });
  });

  describe("error handling", () => {
    it("catches synchronous handler errors and continues", () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const badHandler: ConversionEventHandler = () => {
        throw new Error("sync explosion");
      };
      const goodHandler = vi.fn();

      bus.subscribe("inquiry", badHandler);
      bus.subscribe("inquiry", goodHandler);

      bus.emit(makeEvent({ type: "inquiry" }));

      expect(goodHandler).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it("catches async handler errors without crashing", () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const asyncBadHandler: ConversionEventHandler = async () => {
        throw new Error("async explosion");
      };

      bus.subscribe("inquiry", asyncBadHandler);

      // Should not throw
      expect(() => bus.emit(makeEvent({ type: "inquiry" }))).not.toThrow();
      errorSpy.mockRestore();
    });
  });

  describe("event data integrity", () => {
    it("passes full event data including attribution fields", () => {
      const handler = vi.fn();
      bus.subscribe("*", handler);

      const event = makeEvent({
        type: "booked",
        contactId: "ct_100",
        organizationId: "org_dental",
        value: 250,
        sourceAdId: "ad_whitening",
        sourceCampaignId: "camp_spring",
        metadata: { service: "teeth-whitening", appointmentDate: "2026-03-15" },
      });

      bus.emit(event);

      const received = handler.mock.calls[0]![0] as ConversionEvent;
      expect(received.type).toBe("booked");
      expect(received.contactId).toBe("ct_100");
      expect(received.value).toBe(250);
      expect(received.sourceAdId).toBe("ad_whitening");
      expect(received.sourceCampaignId).toBe("camp_spring");
      expect(received.metadata).toEqual({
        service: "teeth-whitening",
        appointmentDate: "2026-03-15",
      });
    });
  });
});
