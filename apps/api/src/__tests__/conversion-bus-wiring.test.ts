// ---------------------------------------------------------------------------
// Tests for ConversionBus wiring — verify bus, dispatcher, tracker integration
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { InMemoryConversionBus } from "@switchboard/core";
import type { ConversionEvent } from "@switchboard/core";
import { TikTokDispatcher, GoogleOfflineDispatcher } from "@switchboard/digital-ads";

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

describe("TikTokDispatcher registration", () => {
  const makeEvent = (overrides?: Partial<ConversionEvent>): ConversionEvent => ({
    type: "qualified",
    contactId: "contact-tt-1",
    organizationId: "org-1",
    value: 100,
    timestamp: new Date("2026-03-18T12:00:00Z"),
    metadata: {},
    ...overrides,
  });

  it("registers on the bus and receives events via wildcard subscription", async () => {
    const bus = new InMemoryConversionBus();
    const sendEvent = vi.fn().mockResolvedValue({ success: true });
    const crmProvider = {
      getContact: vi.fn().mockResolvedValue({
        id: "contact-tt-1",
        externalId: null,
        channel: null,
        email: "test@example.com",
        firstName: null,
        lastName: null,
        company: null,
        phone: null,
        tags: [],
        status: "active" as const,
        assignedStaffId: null,
        sourceAdId: null,
        sourceCampaignId: null,
        gclid: null,
        fbclid: null,
        ttclid: "tt-click-123",
        normalizedPhone: null,
        normalizedEmail: null,
        utmSource: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        properties: {},
      }),
    };

    const dispatcher = new TikTokDispatcher({
      sendEvent,
      crmProvider,
      pixelId: "pixel-tt-001",
    });
    dispatcher.register(bus);

    const event = makeEvent();
    bus.emit(event);

    // handleEvent is async (fire-and-forget via void), give it a tick
    await vi.waitFor(() => expect(sendEvent).toHaveBeenCalledTimes(1));

    expect(crmProvider.getContact).toHaveBeenCalledWith("contact-tt-1");
    expect(sendEvent).toHaveBeenCalledWith(
      "pixel-tt-001",
      expect.objectContaining({
        event: "Contact", // "qualified" maps to "Contact"
        context: expect.objectContaining({
          user: expect.objectContaining({ ttclid: "tt-click-123" }),
        }),
      }),
    );
  });

  it("skips sending when contact has no ttclid or PII", async () => {
    const bus = new InMemoryConversionBus();
    const sendEvent = vi.fn().mockResolvedValue({ success: true });
    const crmProvider = {
      getContact: vi.fn().mockResolvedValue({
        id: "contact-tt-2",
        externalId: null,
        channel: null,
        email: null,
        firstName: null,
        lastName: null,
        company: null,
        phone: null,
        tags: [],
        status: "active" as const,
        assignedStaffId: null,
        sourceAdId: null,
        sourceCampaignId: null,
        gclid: null,
        fbclid: null,
        ttclid: null,
        normalizedPhone: null,
        normalizedEmail: null,
        utmSource: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        properties: {},
      }),
    };

    const dispatcher = new TikTokDispatcher({
      sendEvent,
      crmProvider,
      pixelId: "pixel-tt-001",
    });
    dispatcher.register(bus);

    bus.emit(makeEvent({ contactId: "contact-tt-2" }));

    // Wait a tick then assert sendEvent was NOT called
    await new Promise((r) => setTimeout(r, 50));
    expect(sendEvent).not.toHaveBeenCalled();
  });
});

describe("GoogleOfflineDispatcher registration", () => {
  const makeEvent = (overrides?: Partial<ConversionEvent>): ConversionEvent => ({
    type: "purchased",
    contactId: "contact-g-1",
    organizationId: "org-1",
    value: 250,
    timestamp: new Date("2026-03-18T14:00:00Z"),
    metadata: {},
    ...overrides,
  });

  it("registers on the bus and uploads conversions for contacts with gclid", async () => {
    const bus = new InMemoryConversionBus();
    const uploadConversion = vi.fn().mockResolvedValue({ success: true });
    const crmProvider = {
      getContact: vi.fn().mockResolvedValue({
        id: "contact-g-1",
        externalId: null,
        channel: null,
        email: null,
        firstName: null,
        lastName: null,
        company: null,
        phone: null,
        tags: [],
        status: "active" as const,
        assignedStaffId: null,
        sourceAdId: null,
        sourceCampaignId: null,
        gclid: "gclid-abc-123",
        fbclid: null,
        ttclid: null,
        normalizedPhone: null,
        normalizedEmail: null,
        utmSource: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        properties: {},
      }),
      // Satisfy the full CrmProvider interface with stubs
      searchContacts: vi.fn(),
      findByExternalId: vi.fn(),
      listDeals: vi.fn(),
      listActivities: vi.fn(),
      getPipelineStatus: vi.fn(),
      createContact: vi.fn(),
      updateContact: vi.fn(),
      archiveContact: vi.fn(),
      createDeal: vi.fn(),
      archiveDeal: vi.fn(),
      logActivity: vi.fn(),
      healthCheck: vi.fn(),
    };

    const dispatcher = new GoogleOfflineDispatcher({
      uploadConversion,
      crmProvider,
      conversionActionId: "conversions/12345",
    });
    dispatcher.register(bus);

    bus.emit(makeEvent());

    await vi.waitFor(() => expect(uploadConversion).toHaveBeenCalledTimes(1));

    expect(crmProvider.getContact).toHaveBeenCalledWith("contact-g-1");
    expect(uploadConversion).toHaveBeenCalledWith(
      expect.objectContaining({
        gclid: "gclid-abc-123",
        conversionAction: "conversions/12345",
        conversionValue: 250,
      }),
    );
  });

  it("skips upload when contact has no gclid", async () => {
    const bus = new InMemoryConversionBus();
    const uploadConversion = vi.fn().mockResolvedValue({ success: true });
    const crmProvider = {
      getContact: vi.fn().mockResolvedValue({
        id: "contact-g-2",
        externalId: null,
        channel: null,
        email: null,
        firstName: null,
        lastName: null,
        company: null,
        phone: null,
        tags: [],
        status: "active" as const,
        assignedStaffId: null,
        sourceAdId: null,
        sourceCampaignId: null,
        gclid: null,
        fbclid: null,
        ttclid: null,
        normalizedPhone: null,
        normalizedEmail: null,
        utmSource: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        properties: {},
      }),
      searchContacts: vi.fn(),
      findByExternalId: vi.fn(),
      listDeals: vi.fn(),
      listActivities: vi.fn(),
      getPipelineStatus: vi.fn(),
      createContact: vi.fn(),
      updateContact: vi.fn(),
      archiveContact: vi.fn(),
      createDeal: vi.fn(),
      archiveDeal: vi.fn(),
      logActivity: vi.fn(),
      healthCheck: vi.fn(),
    };

    const dispatcher = new GoogleOfflineDispatcher({
      uploadConversion,
      crmProvider,
      conversionActionId: "conversions/12345",
    });
    dispatcher.register(bus);

    bus.emit(makeEvent({ contactId: "contact-g-2" }));

    await new Promise((r) => setTimeout(r, 50));
    expect(uploadConversion).not.toHaveBeenCalled();
  });
});
