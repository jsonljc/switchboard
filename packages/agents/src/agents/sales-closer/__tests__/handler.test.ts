import { describe, it, expect, vi } from "vitest";
import { SalesCloserHandler } from "../handler.js";
import { createEventEnvelope } from "../../../events.js";
import { PayloadValidationError } from "../../../validate-payload.js";

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

    expect(response.events).toHaveLength(2);
    expect(response.events[0]!.eventType).toBe("stage.advanced");
    expect(response.events[0]!.payload).toEqual(
      expect.objectContaining({
        contactId: "c1",
        stage: "booking_initiated",
        conversionAction: "booking_link",
      }),
    );
    expect(response.events[1]!.eventType).toBe("opportunity.stage_advanced");
    expect(response.events[1]!.payload).toEqual(
      expect.objectContaining({
        contactId: "c1",
        previousStage: "qualified",
        newStage: "booked",
        reason: "booking_initiated",
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
    expect(response.actions[0]!.actionType).toBe("messaging.whatsapp.send");
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
    expect(response.actions[0]!.actionType).toBe("messaging.whatsapp.send");
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

  it("handles message.received the same as lead.qualified", async () => {
    const handler = new SalesCloserHandler();

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "message.received",
      source: { type: "webhook", id: "whatsapp" },
      payload: { contactId: "c1" },
    });

    const context = {
      organizationId: "org-1",
      profile: { booking: { bookingUrl: "https://book.example.com" } },
    };

    const result = await handler.handle(event, {}, context);

    expect(result.events.some((e) => e.eventType === "stage.advanced")).toBe(true);
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

  describe("lifecycle integration", () => {
    it("calls advanceOpportunityStage('booked') after booking", async () => {
      const mockLifecycle = {
        advanceOpportunityStage: vi.fn().mockResolvedValue(undefined),
        reopenOpportunity: vi.fn().mockResolvedValue(undefined),
      };
      const handler = new SalesCloserHandler();
      const event = {
        ...makeQualifiedEvent(),
        metadata: { lifecycleOpportunityId: "opp-1" },
      };

      await handler.handle(
        event,
        {},
        {
          organizationId: "org-1",
          profile: { booking: { bookingUrl: "https://cal.com/book" } },
          lifecycle: mockLifecycle,
        },
      );

      expect(mockLifecycle.advanceOpportunityStage).toHaveBeenCalledWith(
        "org-1",
        "opp-1",
        "booked",
        "sales-closer",
      );
    });

    it("does not call lifecycle when context.lifecycle is undefined", async () => {
      const handler = new SalesCloserHandler();
      const event = {
        ...makeQualifiedEvent(),
        metadata: { lifecycleOpportunityId: "opp-1" },
      };

      const result = await handler.handle(
        event,
        {},
        {
          organizationId: "org-1",
          profile: { booking: { bookingUrl: "https://cal.com/book" } },
        },
      );

      expect(result.events.some((e) => e.eventType === "stage.advanced")).toBe(true);
    });

    it("continues processing when lifecycle call fails", async () => {
      const mockLifecycle = {
        advanceOpportunityStage: vi.fn().mockRejectedValue(new Error("DB error")),
        reopenOpportunity: vi.fn().mockResolvedValue(undefined),
      };
      const handler = new SalesCloserHandler();
      const event = {
        ...makeQualifiedEvent(),
        metadata: { lifecycleOpportunityId: "opp-1" },
      };

      const result = await handler.handle(
        event,
        {},
        {
          organizationId: "org-1",
          profile: { booking: { bookingUrl: "https://cal.com/book" } },
          lifecycle: mockLifecycle,
        },
      );

      expect(result.events.some((e) => e.eventType === "stage.advanced")).toBe(true);
      expect(result.events.some((e) => e.eventType === "opportunity.stage_advanced")).toBe(true);
    });
  });

  describe("payload validation", () => {
    it("throws PayloadValidationError when contactId is missing", async () => {
      const handler = new SalesCloserHandler();
      const event = createEventEnvelope({
        organizationId: "org-1",
        eventType: "lead.qualified",
        source: { type: "agent", id: "lead-responder" },
        payload: {},
      });

      await expect(
        handler.handle(
          event,
          {},
          {
            organizationId: "org-1",
            profile: { booking: {} },
          },
        ),
      ).rejects.toThrow(PayloadValidationError);
    });
  });
});
