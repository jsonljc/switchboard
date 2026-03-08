// ---------------------------------------------------------------------------
// Tests for ConversionBus wiring — verify bus, dispatcher, tracker integration
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { InMemoryConversionBus } from "@switchboard/core";
import type { ConversionEvent } from "@switchboard/core";

describe("ConversionBus wiring", () => {
  it("InMemoryConversionBus delivers events to wildcard subscribers", () => {
    const bus = new InMemoryConversionBus();
    const handler = vi.fn();

    bus.subscribe("*", handler);

    const event: ConversionEvent = {
      type: "qualified",
      contactId: "contact-1",
      organizationId: "org-1",
      value: 5,
      sourceAdId: "ad-123",
      sourceCampaignId: "camp-456",
      timestamp: new Date(),
      metadata: {},
    };

    bus.emit(event);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("delivers events to type-specific subscribers", () => {
    const bus = new InMemoryConversionBus();
    const qualifiedHandler = vi.fn();
    const bookedHandler = vi.fn();

    bus.subscribe("qualified", qualifiedHandler);
    bus.subscribe("booked", bookedHandler);

    bus.emit({
      type: "qualified",
      contactId: "c1",
      organizationId: "org-1",
      value: 5,
      timestamp: new Date(),
      metadata: {},
    });

    expect(qualifiedHandler).toHaveBeenCalledTimes(1);
    expect(bookedHandler).not.toHaveBeenCalled();
  });

  it("handles errors in handlers without crashing", () => {
    const bus = new InMemoryConversionBus();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const badHandler = () => {
      throw new Error("boom");
    };
    const goodHandler = vi.fn();

    bus.subscribe("*", badHandler);
    bus.subscribe("*", goodHandler);

    bus.emit({
      type: "inquiry",
      contactId: "c1",
      organizationId: "org-1",
      value: 1,
      timestamp: new Date(),
      metadata: {},
    });

    // Good handler still called despite bad handler throwing
    expect(goodHandler).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it("unsubscribe removes handler", () => {
    const bus = new InMemoryConversionBus();
    const handler = vi.fn();

    bus.subscribe("inquiry", handler);
    bus.unsubscribe("inquiry", handler);

    bus.emit({
      type: "inquiry",
      contactId: "c1",
      organizationId: "org-1",
      value: 1,
      timestamp: new Date(),
      metadata: {},
    });

    expect(handler).not.toHaveBeenCalled();
  });
});
