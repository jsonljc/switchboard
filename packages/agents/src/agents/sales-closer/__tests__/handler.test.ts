import { describe, it, expect } from "vitest";
import { SalesCloserHandler } from "../handler.js";
import { createEventEnvelope } from "../../../events.js";

function makeQualifiedEvent(payload: Record<string, unknown> = {}) {
  return createEventEnvelope({
    organizationId: "org-1",
    eventType: "lead.qualified",
    source: { type: "agent", id: "lead-responder" },
    payload: {
      contactId: "c1",
      score: 75,
      tier: "hot",
      ...payload,
    },
    attribution: {
      fbclid: "fb-abc",
      gclid: null,
      ttclid: null,
      sourceCampaignId: "camp-1",
      sourceAdId: "ad-1",
      utmSource: "meta",
      utmMedium: "paid",
      utmCampaign: "spring",
    },
  });
}

describe("SalesCloserHandler", () => {
  it("emits stage.advanced with booking_link when bookingUrl configured", async () => {
    const handler = new SalesCloserHandler();
    const event = makeQualifiedEvent();

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: {
          booking: { bookingUrl: "https://cal.com/clinic/book" },
        },
      },
    );

    expect(response.events).toHaveLength(1);
    expect(response.events[0]!.eventType).toBe("stage.advanced");
    expect(response.events[0]!.payload).toEqual(
      expect.objectContaining({
        contactId: "c1",
        stage: "booking_initiated",
        conversionAction: "booking_link",
      }),
    );
  });

  it("includes bookingUrl in action when configured", async () => {
    const handler = new SalesCloserHandler();
    const event = makeQualifiedEvent();

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: {
          booking: { bookingUrl: "https://cal.com/clinic/book" },
        },
      },
    );

    expect(response.actions).toHaveLength(1);
    expect(response.actions[0]!.actionType).toBe("customer-engagement.appointment.book");
    expect(response.actions[0]!.parameters.bookingUrl).toBe("https://cal.com/clinic/book");
  });

  it("uses direct_booking when no bookingUrl", async () => {
    const handler = new SalesCloserHandler();
    const event = makeQualifiedEvent();

    const response = await handler.handle(
      event,
      {
        defaultServiceType: "teeth-whitening",
        defaultDurationMinutes: 30,
      },
      {
        organizationId: "org-1",
        profile: { booking: {} },
      },
    );

    expect(response.events[0]!.payload).toEqual(
      expect.objectContaining({
        conversionAction: "direct_booking",
      }),
    );
    expect(response.actions[0]!.parameters.serviceType).toBe("teeth-whitening");
    expect(response.actions[0]!.parameters.durationMinutes).toBe(30);
  });

  it("forwards attribution chain to outbound events", async () => {
    const handler = new SalesCloserHandler();
    const event = makeQualifiedEvent();

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { booking: {} },
      },
    );

    expect(response.events[0]!.attribution).toBeDefined();
    expect(response.events[0]!.attribution!.sourceCampaignId).toBe("camp-1");
    expect(response.events[0]!.attribution!.fbclid).toBe("fb-abc");
  });

  it("sets causationId to the inbound event id", async () => {
    const handler = new SalesCloserHandler();
    const event = makeQualifiedEvent();

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { booking: {} },
      },
    );

    expect(response.events[0]!.causationId).toBe(event.eventId);
    expect(response.events[0]!.correlationId).toBe(event.correlationId);
  });

  it("escalates when no booking config in profile", async () => {
    const handler = new SalesCloserHandler();
    const event = makeQualifiedEvent();

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: {},
      },
    );

    expect(response.events).toHaveLength(1);
    expect(response.events[0]!.eventType).toBe("conversation.escalated");
    expect(response.events[0]!.payload).toEqual(
      expect.objectContaining({
        contactId: "c1",
        reason: "no_booking_config",
      }),
    );
  });

  it("escalates when no profile provided", async () => {
    const handler = new SalesCloserHandler();
    const event = makeQualifiedEvent();

    const response = await handler.handle(event, {}, { organizationId: "org-1" });

    expect(response.events[0]!.eventType).toBe("conversation.escalated");
  });

  it("ignores non-lead.qualified events", async () => {
    const handler = new SalesCloserHandler();

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "system", id: "test" },
      payload: {},
    });

    const response = await handler.handle(event, {}, { organizationId: "org-1" });
    expect(response.events).toHaveLength(0);
    expect(response.actions).toHaveLength(0);
  });

  it("includes lead score and tier in stage.advanced payload", async () => {
    const handler = new SalesCloserHandler();
    const event = makeQualifiedEvent({ score: 85, tier: "hot" });

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { booking: {} },
      },
    );

    expect(response.events[0]!.payload).toEqual(
      expect.objectContaining({
        score: 85,
        tier: "hot",
      }),
    );
  });

  it("passes attribution fields to booking action parameters", async () => {
    const handler = new SalesCloserHandler();
    const event = makeQualifiedEvent();

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { booking: {} },
      },
    );

    expect(response.actions[0]!.parameters.sourceAdId).toBe("ad-1");
    expect(response.actions[0]!.parameters.sourceCampaignId).toBe("camp-1");
  });

  it("uses default serviceType and durationMinutes", async () => {
    const handler = new SalesCloserHandler();
    const event = makeQualifiedEvent();

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { booking: {} },
      },
    );

    expect(response.actions[0]!.parameters.serviceType).toBe("consultation");
    expect(response.actions[0]!.parameters.durationMinutes).toBe(60);
  });
});
