import { describe, it, expect, vi } from "vitest";
import { GoogleOfflineDispatcher } from "../google-offline-dispatcher.js";
import type { ConversionBus } from "@switchboard/core";

describe("GoogleOfflineDispatcher", () => {
  it("uploads offline conversion for events with gclid", async () => {
    const uploadFn = vi.fn().mockResolvedValue({ success: true });
    const crmProvider = {
      getContact: vi.fn().mockResolvedValue({
        id: "c1",
        email: "test@example.com",
        gclid: "gclid-123",
      }),
    };

    const dispatcher = new GoogleOfflineDispatcher({
      uploadConversion: uploadFn,
      crmProvider: crmProvider as never,
      conversionActionId: "conversions/123",
    });

    await dispatcher.handleEvent({
      type: "booked",
      contactId: "c1",
      organizationId: "org-1",
      value: 100,
      timestamp: new Date("2026-03-16T10:00:00Z"),
      metadata: {},
    });

    expect(uploadFn).toHaveBeenCalledWith(
      expect.objectContaining({
        gclid: "gclid-123",
        conversionAction: "conversions/123",
        conversionValue: 100,
        currencyCode: "SGD",
      }),
    );
  });

  it("skips events without gclid on contact", async () => {
    const uploadFn = vi.fn();
    const crmProvider = {
      getContact: vi.fn().mockResolvedValue({ id: "c1", email: "test@example.com", gclid: null }),
    };

    const dispatcher = new GoogleOfflineDispatcher({
      uploadConversion: uploadFn,
      crmProvider: crmProvider as never,
      conversionActionId: "conversions/123",
    });

    await dispatcher.handleEvent({
      type: "booked",
      contactId: "c1",
      organizationId: "org-1",
      value: 100,
      timestamp: new Date(),
      metadata: {},
    });

    expect(uploadFn).not.toHaveBeenCalled();
  });

  it("registers on ConversionBus with wildcard", () => {
    const bus = { subscribe: vi.fn(), unsubscribe: vi.fn(), emit: vi.fn() };
    const dispatcher = new GoogleOfflineDispatcher({
      uploadConversion: vi.fn(),
      crmProvider: {} as never,
      conversionActionId: "conversions/123",
    });

    dispatcher.register(bus as ConversionBus);

    expect(bus.subscribe).toHaveBeenCalledWith("*", expect.any(Function));
  });

  it("handles upload errors gracefully", async () => {
    const uploadFn = vi.fn().mockRejectedValue(new Error("API error"));
    const crmProvider = {
      getContact: vi.fn().mockResolvedValue({ id: "c1", gclid: "gclid-123" }),
    };

    const dispatcher = new GoogleOfflineDispatcher({
      uploadConversion: uploadFn,
      crmProvider: crmProvider as never,
      conversionActionId: "conversions/123",
    });

    // Should not throw
    await dispatcher.handleEvent({
      type: "booked",
      contactId: "c1",
      organizationId: "org-1",
      value: 100,
      timestamp: new Date(),
      metadata: {},
    });

    expect(uploadFn).toHaveBeenCalled();
  });
});
