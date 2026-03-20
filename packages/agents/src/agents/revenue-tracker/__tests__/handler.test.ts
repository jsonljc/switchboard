import { describe, it, expect } from "vitest";
import { RevenueTrackerHandler } from "../handler.js";
import { createEventEnvelope } from "../../../events.js";

function makeRevenueEvent(payload: Record<string, unknown> = {}) {
  return createEventEnvelope({
    organizationId: "org-1",
    eventType: "revenue.recorded",
    source: { type: "system", id: "payments" },
    payload: {
      contactId: "c1",
      amount: 500,
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

describe("RevenueTrackerHandler", () => {
  it("emits revenue.attributed on revenue.recorded", async () => {
    const handler = new RevenueTrackerHandler();
    const event = makeRevenueEvent();

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { revenue: { attributionModel: "last_click" } },
      },
    );

    expect(response.events).toHaveLength(1);
    expect(response.events[0]!.eventType).toBe("revenue.attributed");
    expect(response.events[0]!.payload).toEqual(
      expect.objectContaining({
        contactId: "c1",
        amount: 500,
        currency: "USD",
        campaignId: "camp-1",
        adId: "ad-1",
        attributionModel: "last_click",
      }),
    );
  });

  it("uses default attribution model when not configured", async () => {
    const handler = new RevenueTrackerHandler();
    const event = makeRevenueEvent();

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { revenue: {} },
      },
    );

    const payload = response.events[0]!.payload as Record<string, unknown>;
    expect(payload.attributionModel).toBe("last_click");
  });

  it("includes platform source in attribution payload", async () => {
    const handler = new RevenueTrackerHandler();
    const event = makeRevenueEvent();

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { revenue: {} },
      },
    );

    const payload = response.events[0]!.payload as Record<string, unknown>;
    expect(payload.utmSource).toBe("meta");
    expect(payload.utmMedium).toBe("paid");
    expect(payload.utmCampaign).toBe("spring");
  });

  it("logs pipeline progression on stage.advanced", async () => {
    const handler = new RevenueTrackerHandler();
    const event = makeStageEvent("proposal_sent");

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { revenue: { trackPipeline: true } },
      },
    );

    expect(response.actions).toEqual([
      {
        actionType: "crm.activity.log",
        parameters: {
          contactId: "c1",
          activityType: "stage_transition",
          stage: "proposal_sent",
        },
      },
    ]);
  });

  it("skips pipeline logging when trackPipeline is false", async () => {
    const handler = new RevenueTrackerHandler();
    const event = makeStageEvent("proposal_sent");

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { revenue: { trackPipeline: false } },
      },
    );

    expect(response.actions).toHaveLength(0);
    expect(response.events).toHaveLength(0);
  });

  it("defaults trackPipeline to true", async () => {
    const handler = new RevenueTrackerHandler();
    const event = makeStageEvent("booked");

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { revenue: {} },
      },
    );

    expect(response.actions).toHaveLength(1);
    expect(response.actions[0]!.actionType).toBe("crm.activity.log");
  });

  it("escalates when no revenue config in profile", async () => {
    const handler = new RevenueTrackerHandler();
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
        reason: "no_revenue_config",
      }),
    );
  });

  it("silently skips stage.advanced when no revenue config", async () => {
    const handler = new RevenueTrackerHandler();
    const event = makeStageEvent("booked");

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: {},
      },
    );

    expect(response.events).toHaveLength(0);
    expect(response.actions).toHaveLength(0);
  });

  it("forwards attribution chain to outbound events", async () => {
    const handler = new RevenueTrackerHandler();
    const event = makeRevenueEvent();

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { revenue: {} },
      },
    );

    expect(response.events[0]!.attribution).toBeDefined();
    expect(response.events[0]!.attribution!.sourceCampaignId).toBe("camp-1");
    expect(response.events[0]!.attribution!.fbclid).toBe("fb-abc");
  });

  it("sets causationId to the inbound event id", async () => {
    const handler = new RevenueTrackerHandler();
    const event = makeRevenueEvent();

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { revenue: {} },
      },
    );

    expect(response.events[0]!.causationId).toBe(event.eventId);
    expect(response.events[0]!.correlationId).toBe(event.correlationId);
  });

  it("dispatches conversions to connected platforms on revenue.recorded", async () => {
    const handler = new RevenueTrackerHandler();
    const event = makeRevenueEvent();

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: {
          revenue: {},
          ads: { connectedPlatforms: ["meta", "google"] },
        },
      },
    );

    const conversionActions = response.actions.filter(
      (a) => a.actionType === "digital-ads.conversion.send",
    );

    expect(conversionActions).toHaveLength(2);
    expect(conversionActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          parameters: expect.objectContaining({
            platform: "meta",
            eventName: "Purchase",
            value: 500,
          }),
        }),
        expect.objectContaining({
          parameters: expect.objectContaining({
            platform: "google",
            eventName: "Purchase",
            value: 500,
          }),
        }),
      ]),
    );
  });

  it("skips conversion dispatch when no ads config", async () => {
    const handler = new RevenueTrackerHandler();
    const event = makeRevenueEvent();

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { revenue: {} },
      },
    );

    const conversionActions = response.actions.filter(
      (a) => a.actionType === "digital-ads.conversion.send",
    );

    expect(conversionActions).toHaveLength(0);
    expect(response.events[0]!.eventType).toBe("revenue.attributed");
  });

  it("ignores unhandled event types", async () => {
    const handler = new RevenueTrackerHandler();

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

  it("handles revenue with no attribution gracefully", async () => {
    const handler = new RevenueTrackerHandler();

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "revenue.recorded",
      source: { type: "system", id: "payments" },
      payload: { contactId: "c1", amount: 100 },
    });

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { revenue: {} },
      },
    );

    expect(response.events).toHaveLength(1);
    expect(response.events[0]!.eventType).toBe("revenue.attributed");
    const payload = response.events[0]!.payload as Record<string, unknown>;
    expect(payload.campaignId).toBeNull();
    expect(payload.adId).toBeNull();
  });

  it("uses currency from event payload", async () => {
    const handler = new RevenueTrackerHandler();
    const event = makeRevenueEvent({ currency: "EUR" });

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { revenue: {} },
      },
    );

    const payload = response.events[0]!.payload as Record<string, unknown>;
    expect(payload.currency).toBe("EUR");
  });
});
