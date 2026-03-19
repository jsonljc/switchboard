import { describe, it, expect } from "vitest";
import { AdOptimizerHandler } from "../handler.js";
import { createEventEnvelope } from "../../../events.js";

function makeRevenueEvent(payload: Record<string, unknown> = {}) {
  return createEventEnvelope({
    organizationId: "org-1",
    eventType: "revenue.recorded",
    source: { type: "system", id: "payments" },
    payload: {
      contactId: "c1",
      amount: 250,
      currency: "USD",
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

function makeStageEvent(stage: string, payload: Record<string, unknown> = {}) {
  return createEventEnvelope({
    organizationId: "org-1",
    eventType: "stage.advanced",
    source: { type: "agent", id: "sales-closer" },
    payload: {
      contactId: "c1",
      stage,
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

describe("AdOptimizerHandler", () => {
  it("sends conversion to connected platforms on revenue.recorded", async () => {
    const handler = new AdOptimizerHandler();
    const event = makeRevenueEvent();

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: {
          ads: { connectedPlatforms: ["meta", "google"] },
        },
      },
    );

    expect(response.actions).toHaveLength(2);
    expect(response.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionType: "digital-ads.conversion.send",
          parameters: expect.objectContaining({
            platform: "meta",
            eventName: "Purchase",
            contactId: "c1",
            value: 250,
          }),
        }),
        expect.objectContaining({
          actionType: "digital-ads.conversion.send",
          parameters: expect.objectContaining({
            platform: "google",
            eventName: "Purchase",
          }),
        }),
      ]),
    );
  });

  it("emits ad.optimized event on revenue.recorded", async () => {
    const handler = new AdOptimizerHandler();
    const event = makeRevenueEvent();

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: {
          ads: { connectedPlatforms: ["meta"] },
        },
      },
    );

    expect(response.events).toHaveLength(1);
    expect(response.events[0]!.eventType).toBe("ad.optimized");
    expect(response.events[0]!.payload).toEqual(
      expect.objectContaining({
        contactId: "c1",
        action: "conversion_sent",
        platforms: ["meta"],
        eventName: "Purchase",
        value: 250,
      }),
    );
  });

  it("sends stage conversion when conversionEventMap configured", async () => {
    const handler = new AdOptimizerHandler();
    const event = makeStageEvent("booking_initiated");

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: {
          ads: {
            connectedPlatforms: ["meta"],
            conversionEventMap: { booking_initiated: "Lead" },
          },
        },
      },
    );

    expect(response.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionType: "digital-ads.conversion.send",
          parameters: expect.objectContaining({
            platform: "meta",
            eventName: "Lead",
            contactId: "c1",
          }),
        }),
      ]),
    );
  });

  it("skips stage.advanced when stage not in conversionEventMap", async () => {
    const handler = new AdOptimizerHandler();
    const event = makeStageEvent("nurture_started");

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: {
          ads: {
            connectedPlatforms: ["meta"],
            conversionEventMap: { booking_initiated: "Lead" },
          },
        },
      },
    );

    expect(response.events).toHaveLength(0);
    expect(response.actions).toHaveLength(0);
  });

  it("skips stage.advanced when no conversionEventMap", async () => {
    const handler = new AdOptimizerHandler();
    const event = makeStageEvent("booking_initiated");

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: {
          ads: { connectedPlatforms: ["meta"] },
        },
      },
    );

    expect(response.events).toHaveLength(0);
    expect(response.actions).toHaveLength(0);
  });

  it("escalates when no ads config in profile", async () => {
    const handler = new AdOptimizerHandler();
    const event = makeRevenueEvent();

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
        reason: "no_ads_config",
      }),
    );
  });

  it("escalates when no connected platforms", async () => {
    const handler = new AdOptimizerHandler();
    const event = makeRevenueEvent();

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: {
          ads: { connectedPlatforms: [] },
        },
      },
    );

    expect(response.events[0]!.eventType).toBe("conversation.escalated");
    expect(response.events[0]!.payload).toEqual(
      expect.objectContaining({
        reason: "no_connected_platforms",
      }),
    );
  });

  it("forwards attribution chain to outbound events", async () => {
    const handler = new AdOptimizerHandler();
    const event = makeRevenueEvent();

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { ads: { connectedPlatforms: ["meta"] } },
      },
    );

    expect(response.events[0]!.attribution).toBeDefined();
    expect(response.events[0]!.attribution!.sourceCampaignId).toBe("camp-1");
    expect(response.events[0]!.attribution!.fbclid).toBe("fb-abc");
  });

  it("sets causationId to the inbound event id", async () => {
    const handler = new AdOptimizerHandler();
    const event = makeRevenueEvent();

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { ads: { connectedPlatforms: ["meta"] } },
      },
    );

    expect(response.events[0]!.causationId).toBe(event.eventId);
    expect(response.events[0]!.correlationId).toBe(event.correlationId);
  });

  it("ignores unhandled event types", async () => {
    const handler = new AdOptimizerHandler();

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

  it("includes attribution in conversion action parameters", async () => {
    const handler = new AdOptimizerHandler();
    const event = makeRevenueEvent();

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { ads: { connectedPlatforms: ["meta"] } },
      },
    );

    const action = response.actions[0]!;
    expect(action.parameters.fbclid).toBe("fb-abc");
    expect(action.parameters.sourceCampaignId).toBe("camp-1");
    expect(action.parameters.sourceAdId).toBe("ad-1");
  });

  it("uses currency from event payload when available", async () => {
    const handler = new AdOptimizerHandler();
    const event = makeRevenueEvent({ currency: "EUR" });

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { ads: { connectedPlatforms: ["meta"] } },
      },
    );

    expect(response.actions[0]!.parameters.currency).toBe("EUR");
  });
});
