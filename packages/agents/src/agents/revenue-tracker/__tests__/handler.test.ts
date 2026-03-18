import { describe, it, expect } from "vitest";
import { RevenueTrackerHandler } from "../handler.js";
import { createEventEnvelope } from "../../../events.js";
import type { AttributionChain } from "../../../events.js";

function makeRevenueEvent(
  overrides: Record<string, unknown> = {},
  attribution?: Partial<AttributionChain>,
) {
  return createEventEnvelope({
    organizationId: "org-1",
    eventType: "revenue.recorded",
    source: { type: "agent", id: "sales-closer" },
    payload: {
      contactId: "c1",
      amount: 500,
      currency: "USD",
      ...overrides,
    },
    attribution: {
      fbclid: null,
      gclid: null,
      ttclid: null,
      sourceCampaignId: null,
      sourceAdId: null,
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      ...attribution,
    },
  });
}

function makeStageEvent(overrides: Record<string, unknown> = {}) {
  return createEventEnvelope({
    organizationId: "org-1",
    eventType: "stage.advanced",
    source: { type: "agent", id: "sales-closer" },
    payload: {
      contactId: "c1",
      stage: "proposal",
      ...overrides,
    },
  });
}

describe("RevenueTrackerHandler", () => {
  it("emits revenue.attributed event for revenue.recorded", async () => {
    const handler = new RevenueTrackerHandler();
    const event = makeRevenueEvent();
    const response = await handler.handle(event, {}, { organizationId: "org-1" });

    expect(response.events).toHaveLength(1);
    expect(response.events[0]!.eventType).toBe("revenue.attributed");
    expect(response.events[0]!.payload).toEqual(
      expect.objectContaining({
        contactId: "c1",
        amount: 500,
        campaignId: null,
        platformsNotified: [],
      }),
    );
  });

  it("dispatches Meta CAPI conversion when fbclid present", async () => {
    const handler = new RevenueTrackerHandler();
    const event = makeRevenueEvent({}, { fbclid: "fb-abc", sourceCampaignId: "camp-1" });
    const response = await handler.handle(event, {}, { organizationId: "org-1" });

    expect(response.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionType: "digital-ads.capi.dispatch",
          parameters: expect.objectContaining({
            eventName: "Purchase",
            fbclid: "fb-abc",
            value: 500,
            currency: "USD",
          }),
        }),
      ]),
    );
    const payload = response.events[0]!.payload as Record<string, unknown>;
    expect(payload.platformsNotified).toContain("meta");
  });

  it("dispatches Google offline conversion when gclid present", async () => {
    const handler = new RevenueTrackerHandler();
    const event = makeRevenueEvent({}, { gclid: "gclid-xyz" });
    const response = await handler.handle(event, {}, { organizationId: "org-1" });

    expect(response.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionType: "digital-ads.google.offline_conversion",
          parameters: expect.objectContaining({
            gclid: "gclid-xyz",
            conversionAction: "purchase",
            conversionValue: 500,
          }),
        }),
      ]),
    );
    const payload = response.events[0]!.payload as Record<string, unknown>;
    expect(payload.platformsNotified).toContain("google");
  });

  it("dispatches TikTok offline conversion when ttclid present", async () => {
    const handler = new RevenueTrackerHandler();
    const event = makeRevenueEvent({}, { ttclid: "tt-123" });
    const response = await handler.handle(event, {}, { organizationId: "org-1" });

    expect(response.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionType: "digital-ads.tiktok.offline_conversion",
          parameters: expect.objectContaining({
            eventName: "CompletePayment",
            ttclid: "tt-123",
            value: 500,
          }),
        }),
      ]),
    );
    const payload = response.events[0]!.payload as Record<string, unknown>;
    expect(payload.platformsNotified).toContain("tiktok");
  });

  it("dispatches to multiple platforms when multiple click IDs present", async () => {
    const handler = new RevenueTrackerHandler();
    const event = makeRevenueEvent(
      {},
      { fbclid: "fb-1", gclid: "gc-1", ttclid: "tt-1", sourceCampaignId: "camp-x" },
    );
    const response = await handler.handle(event, {}, { organizationId: "org-1" });

    expect(response.actions).toHaveLength(3);
    const payload = response.events[0]!.payload as Record<string, unknown>;
    expect(payload.platformsNotified).toEqual(expect.arrayContaining(["meta", "google", "tiktok"]));
    expect(payload.campaignId).toBe("camp-x");
  });

  it("forwards attribution chain to outbound event", async () => {
    const handler = new RevenueTrackerHandler();
    const event = makeRevenueEvent({}, { fbclid: "fb-abc", sourceCampaignId: "camp-1" });
    const response = await handler.handle(event, {}, { organizationId: "org-1" });

    expect(response.events[0]!.attribution).toBeDefined();
    expect(response.events[0]!.attribution!.fbclid).toBe("fb-abc");
    expect(response.events[0]!.attribution!.sourceCampaignId).toBe("camp-1");
  });

  it("sets causationId to the inbound event id", async () => {
    const handler = new RevenueTrackerHandler();
    const event = makeRevenueEvent();
    const response = await handler.handle(event, {}, { organizationId: "org-1" });

    expect(response.events[0]!.causationId).toBe(event.eventId);
    expect(response.events[0]!.correlationId).toBe(event.correlationId);
  });

  it("includes attribution summary in state", async () => {
    const handler = new RevenueTrackerHandler();
    const event = makeRevenueEvent({ amount: 250 }, { fbclid: "fb-1", sourceCampaignId: "camp-2" });
    const response = await handler.handle(event, {}, { organizationId: "org-1" });

    expect(response.state).toEqual({
      contactId: "c1",
      amount: 250,
      campaignId: "camp-2",
      platformsNotified: ["meta"],
    });
  });

  it("logs CRM activity for stage.advanced events", async () => {
    const handler = new RevenueTrackerHandler();
    const event = makeStageEvent();
    const response = await handler.handle(event, {}, { organizationId: "org-1" });

    expect(response.events).toHaveLength(0);
    expect(response.actions).toEqual([
      {
        actionType: "crm.activity.log",
        parameters: {
          contactId: "c1",
          activityType: "stage_transition",
          stage: "proposal",
        },
      },
    ]);
    expect(response.state).toEqual({ logged: true, stage: "proposal" });
  });

  it("ignores unrecognized event types", async () => {
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

  it("defaults currency to USD when not provided", async () => {
    const handler = new RevenueTrackerHandler();
    const event = makeRevenueEvent(
      { contactId: "c2", amount: 100, currency: undefined },
      { fbclid: "fb-x" },
    );
    const response = await handler.handle(event, {}, { organizationId: "org-1" });

    const capiAction = response.actions.find((a) => a.actionType === "digital-ads.capi.dispatch");
    expect(capiAction!.parameters.currency).toBe("USD");
  });

  it("accepts deps with default empty object", () => {
    const handler = new RevenueTrackerHandler();
    expect(handler).toBeDefined();
  });
});
