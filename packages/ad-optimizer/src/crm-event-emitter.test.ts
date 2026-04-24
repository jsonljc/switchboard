import { describe, it, expect } from "vitest";
import { buildConversionEvent } from "./crm-event-emitter.js";

describe("buildConversionEvent", () => {
  const baseParams = {
    orgId: "org_1",
    accountId: "act_1",
    type: "booked" as const,
    contact: {
      id: "ct_1",
      email: "test@example.com",
      phone: "+6591234567",
    },
    occurredAt: new Date("2026-04-20T10:00:00Z"),
    source: {
      model: "Booking" as const,
      id: "bk_1",
      transition: "status_confirmed",
    },
  };

  it("produces a valid ConversionEvent", () => {
    const event = buildConversionEvent(baseParams);
    expect(event.type).toBe("booked");
    expect(event.organizationId).toBe("org_1");
    expect(event.accountId).toBe("act_1");
    expect(event.contactId).toBe("ct_1");
    expect(event.occurredAt).toEqual(new Date("2026-04-20T10:00:00Z"));
  });

  it("maps contact email/phone to customer", () => {
    const event = buildConversionEvent(baseParams);
    expect(event.customer).toEqual({ email: "test@example.com", phone: "+6591234567" });
  });

  it("maps leadgenId to attribution.lead_id", () => {
    const event = buildConversionEvent({
      ...baseParams,
      contact: { ...baseParams.contact, leadgenId: "lead_abc" },
    });
    expect(event.attribution?.lead_id).toBe("lead_abc");
  });

  it("maps contact.attribution fields to event.attribution", () => {
    const event = buildConversionEvent({
      ...baseParams,
      contact: {
        ...baseParams.contact,
        attribution: {
          fbclid: "fb_xyz",
          fbclidTimestamp: new Date("2026-04-19T00:00:00Z"),
          sourceCampaignId: "camp_1",
          sourceAdSetId: "adset_1",
          sourceAdId: "ad_1",
          eventSourceUrl: "https://example.com",
          clientUserAgent: "Mozilla/5.0",
        },
      },
    });
    expect(event.attribution?.fbclid).toBe("fb_xyz");
    expect(event.attribution?.sourceCampaignId).toBe("camp_1");
    expect(event.attribution?.eventSourceUrl).toBe("https://example.com");
  });

  it("constructs deterministic eventId", () => {
    const event = buildConversionEvent(baseParams);
    expect(event.eventId).toBe("org_1:act_1:Booking:bk_1:booked:status_confirmed");
  });

  it("uses default transition when none provided", () => {
    const event = buildConversionEvent({
      ...baseParams,
      source: { model: "Booking", id: "bk_1" },
    });
    expect(event.eventId).toBe("org_1:act_1:Booking:bk_1:booked:default");
  });

  it("same inputs produce same eventId", () => {
    const a = buildConversionEvent(baseParams);
    const b = buildConversionEvent(baseParams);
    expect(a.eventId).toBe(b.eventId);
  });

  it("sets source to model name and sourceContext to structured object", () => {
    const event = buildConversionEvent(baseParams);
    expect(event.source).toBe("Booking");
    expect(event.sourceContext).toEqual({
      model: "Booking",
      id: "bk_1",
      transition: "status_confirmed",
    });
  });

  it("sets metadata to empty object", () => {
    const event = buildConversionEvent(baseParams);
    expect(event.metadata).toEqual({});
  });

  it("passes value and currency through", () => {
    const event = buildConversionEvent({
      ...baseParams,
      type: "purchased",
      value: 500,
      currency: "SGD",
    });
    expect(event.value).toBe(500);
    expect(event.currency).toBe("SGD");
  });

  it("omits value when not provided", () => {
    const event = buildConversionEvent(baseParams);
    expect(event.value).toBeUndefined();
    expect(event.currency).toBeUndefined();
  });
});
