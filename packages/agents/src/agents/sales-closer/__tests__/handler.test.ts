import { describe, it, expect, vi } from "vitest";
import { SalesCloserHandler } from "../handler.js";
import { createEventEnvelope } from "../../../events.js";
import type { SalesCloserDeps } from "../types.js";

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
  it("emits stage.advanced with booking action when bookingUrl configured", async () => {
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

  it("returns send_booking_link action when bookingUrl configured", async () => {
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

    expect(response.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionType: "customer-engagement.appointment.book",
          parameters: expect.objectContaining({
            contactId: "c1",
            bookingUrl: "https://cal.com/clinic/book",
          }),
        }),
      ]),
    );
  });

  it("returns book_appointment action when no bookingUrl (direct calendar)", async () => {
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

    expect(response.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionType: "customer-engagement.appointment.book",
          parameters: expect.objectContaining({
            contactId: "c1",
            serviceType: "teeth-whitening",
            durationMinutes: 30,
          }),
        }),
      ]),
    );
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

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
      },
    );

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

    const bookAction = response.actions.find(
      (a) => a.actionType === "customer-engagement.appointment.book",
    );
    expect(bookAction).toBeDefined();
    expect(bookAction!.parameters.sourceAdId).toBe("ad-1");
    expect(bookAction!.parameters.sourceCampaignId).toBe("camp-1");
  });

  it("checks availability before booking when dep provided", async () => {
    const deps: SalesCloserDeps = {
      getAvailableSlots: vi
        .fn()
        .mockResolvedValue([
          { startTime: "2026-03-19T10:00:00Z", endTime: "2026-03-19T11:00:00Z", providerId: "p1" },
        ]),
    };
    const handler = new SalesCloserHandler(deps);

    const event = makeQualifiedEvent();
    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { booking: { bookingUrl: "https://cal.com/demo" } },
      },
    );

    expect(deps.getAvailableSlots).toHaveBeenCalled();
    expect(response.state?.availableSlots).toBe(1);
  });

  it("escalates when no slots available", async () => {
    const deps: SalesCloserDeps = {
      getAvailableSlots: vi.fn().mockResolvedValue([]),
    };
    const handler = new SalesCloserHandler(deps);

    const event = makeQualifiedEvent();
    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { booking: { bookingUrl: "https://cal.com/demo" } },
      },
    );

    const escalation = response.events.find((e) => e.eventType === "conversation.escalated");
    expect(escalation).toBeDefined();
    expect(escalation!.payload).toEqual(expect.objectContaining({ reason: "no_available_slots" }));
  });

  it("works without deps (backward compatible)", async () => {
    const handler = new SalesCloserHandler();

    const event = makeQualifiedEvent();
    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { booking: { bookingUrl: "https://cal.com/demo" } },
      },
    );

    // Should still emit stage.advanced and booking action
    expect(response.events.some((e) => e.eventType === "stage.advanced")).toBe(true);
    expect(
      response.actions.some((a) => a.actionType === "customer-engagement.appointment.book"),
    ).toBe(true);
  });
});
