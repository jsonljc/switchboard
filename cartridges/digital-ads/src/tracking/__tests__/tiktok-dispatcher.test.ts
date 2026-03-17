import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { TikTokDispatcher } from "../tiktok-dispatcher.js";
import { InMemoryConversionBus } from "@switchboard/core";
import type { ConversionEvent } from "@switchboard/core";
import type { CrmContact } from "@switchboard/schemas";

function makeContact(overrides?: Partial<CrmContact>): CrmContact {
  return {
    id: "ct_1",
    externalId: "ext_1",
    channel: "web",
    email: "jane@example.com",
    firstName: "Jane",
    lastName: "Doe",
    company: null,
    phone: "+60123456789",
    tags: [],
    status: "active",
    assignedStaffId: null,
    sourceAdId: null,
    sourceCampaignId: "camp_tt",
    gclid: null,
    fbclid: null,
    ttclid: "tt_click_123",
    normalizedPhone: "+60123456789",
    normalizedEmail: "jane@example.com",
    utmSource: "tiktok",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    properties: {},
    ...overrides,
  };
}

function makeEvent(overrides?: Partial<ConversionEvent>): ConversionEvent {
  return {
    type: "purchased",
    contactId: "ct_1",
    organizationId: "org_1",
    value: 350,
    timestamp: new Date("2026-03-17T10:00:00Z"),
    metadata: {},
    ...overrides,
  };
}

describe("TikTokDispatcher", () => {
  let mockSendEvent: ReturnType<typeof vi.fn>;
  let mockCrmProvider: { getContact: ReturnType<typeof vi.fn> };
  let dispatcher: TikTokDispatcher;

  beforeEach(() => {
    mockSendEvent = vi.fn().mockResolvedValue({ success: true });
    mockCrmProvider = {
      getContact: vi.fn().mockResolvedValue(makeContact()),
    };
    dispatcher = new TikTokDispatcher({
      sendEvent: mockSendEvent,
      crmProvider: mockCrmProvider as never,
      pixelId: "pixel_tt_1",
      currency: "MYR",
    });
  });

  it("sends CompletePayment for purchased events", async () => {
    await dispatcher.handleEvent(makeEvent({ type: "purchased" }));

    expect(mockSendEvent).toHaveBeenCalledWith(
      "pixel_tt_1",
      expect.objectContaining({
        event: "CompletePayment",
        event_id: expect.any(String),
      }),
    );
  });

  it("sends SubmitForm for inquiry events", async () => {
    await dispatcher.handleEvent(makeEvent({ type: "inquiry" }));

    expect(mockSendEvent).toHaveBeenCalledWith(
      "pixel_tt_1",
      expect.objectContaining({ event: "SubmitForm" }),
    );
  });

  it("includes hashed PII and ttclid", async () => {
    await dispatcher.handleEvent(makeEvent());

    const payload = mockSendEvent.mock.calls[0][1];
    expect(payload.context.user.ttclid).toBe("tt_click_123");
    expect(payload.context.user.email).toBe(
      createHash("sha256").update("jane@example.com").digest("hex"),
    );
    expect(payload.context.user.phone_number).toBe(
      createHash("sha256").update("+60123456789").digest("hex"),
    );
  });

  it("skips when no ttclid and no PII", async () => {
    mockCrmProvider.getContact.mockResolvedValue(
      makeContact({ ttclid: null, email: null, phone: null }),
    );

    await dispatcher.handleEvent(makeEvent());

    expect(mockSendEvent).not.toHaveBeenCalled();
  });

  it("registers on ConversionBus", () => {
    const bus = new InMemoryConversionBus();
    dispatcher.register(bus);

    bus.emit(makeEvent());

    expect(mockCrmProvider.getContact).toHaveBeenCalled();
  });

  it("handles send errors gracefully", async () => {
    mockSendEvent.mockRejectedValue(new Error("Network error"));

    // Should not throw
    await dispatcher.handleEvent(makeEvent());
  });
});
