import { describe, it, expect } from "vitest";
import { AdOptimizerHandler } from "../handler.js";
import { createEventEnvelope } from "../../../events.js";
import { PayloadValidationError } from "../../../validate-payload.js";

function makeAttributionEvent(payload: Record<string, unknown> = {}) {
  return createEventEnvelope({
    organizationId: "org-1",
    eventType: "revenue.attributed",
    source: { type: "agent", id: "revenue-tracker" },
    payload: {
      campaignId: "camp-1",
      amount: 250,
      attributionModel: "last_click",
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

function makeAnomalyEvent(payload: Record<string, unknown> = {}) {
  return createEventEnvelope({
    organizationId: "org-1",
    eventType: "ad.anomaly_detected",
    source: { type: "system", id: "monitoring" },
    payload: {
      campaignId: "camp-1",
      platform: "meta",
      metric: "ROAS",
      dropPercent: 50,
      ...payload,
    },
  });
}

function makeReviewEvent(payload: Record<string, unknown> = {}) {
  return createEventEnvelope({
    organizationId: "org-1",
    eventType: "ad.performance_review",
    source: { type: "system", id: "scheduled-runner" },
    payload: { agentId: "ad-optimizer", triggeredBy: "schedule", ...payload },
  });
}

describe("AdOptimizerHandler", () => {
  it("records attribution state without actions on revenue.attributed", async () => {
    const handler = new AdOptimizerHandler();
    const event = makeAttributionEvent();
    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { ads: { connectedPlatforms: ["meta"] } },
      },
    );
    expect(response.events).toHaveLength(0);
    expect(response.actions).toHaveLength(0);
    expect(response.state).toBeDefined();
    expect(response.state!.lastAttribution).toBeDefined();
  });

  it("returns empty when no ads config on revenue.attributed", async () => {
    const handler = new AdOptimizerHandler();
    const event = makeAttributionEvent();
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

  it("pauses campaign on anomaly above threshold", async () => {
    const handler = new AdOptimizerHandler();
    const event = makeAnomalyEvent({ dropPercent: 50 });
    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { ads: { connectedPlatforms: ["meta"], anomalyThreshold: 30 } },
      },
    );
    expect(response.events).toHaveLength(1);
    expect(response.events[0]!.eventType).toBe("ad.optimized");
    expect(response.events[0]!.payload).toEqual(
      expect.objectContaining({ action: "anomaly_response", recommendation: "pause_campaign" }),
    );
    expect(response.actions).toHaveLength(1);
    expect(response.actions[0]!.actionType).toBe("digital-ads.campaign.adjust");
    expect(response.actions[0]!.parameters.adjustment).toBe("pause");
  });

  it("ignores anomaly below threshold", async () => {
    const handler = new AdOptimizerHandler();
    const event = makeAnomalyEvent({ dropPercent: 10 });
    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { ads: { anomalyThreshold: 30 } },
      },
    );
    expect(response.events).toHaveLength(0);
    expect(response.actions).toHaveLength(0);
  });

  it("escalates anomaly when no ads config", async () => {
    const handler = new AdOptimizerHandler();
    const event = makeAnomalyEvent();
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
      expect.objectContaining({ reason: "no_ads_config" }),
    );
  });

  it("runs budget review on ad.performance_review", async () => {
    const handler = new AdOptimizerHandler();
    const event = makeReviewEvent();
    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { ads: { connectedPlatforms: ["meta", "google"] } },
      },
    );
    expect(response.events).toHaveLength(1);
    expect(response.events[0]!.eventType).toBe("ad.optimized");
    expect(response.events[0]!.payload).toEqual(
      expect.objectContaining({ action: "budget_review", platforms: ["meta", "google"] }),
    );
    expect(response.actions).toHaveLength(2);
    expect(response.actions[0]!.actionType).toBe("digital-ads.budget.analyze");
  });

  it("escalates performance review when no ads config", async () => {
    const handler = new AdOptimizerHandler();
    const event = makeReviewEvent();
    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: {},
      },
    );
    expect(response.events[0]!.eventType).toBe("conversation.escalated");
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

  it("forwards attribution chain to anomaly response events", async () => {
    const handler = new AdOptimizerHandler();
    const event = makeAnomalyEvent();
    // Add attribution to the event
    (event as unknown as Record<string, unknown>).attribution = {
      fbclid: "fb-abc",
      gclid: null,
      ttclid: null,
      sourceCampaignId: "camp-1",
      sourceAdId: "ad-1",
      utmSource: "meta",
      utmMedium: "paid",
      utmCampaign: "spring",
    };
    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { ads: { connectedPlatforms: ["meta"] } },
      },
    );
    expect(response.events[0]!.attribution).toBeDefined();
  });

  it("sets causationId on emitted events", async () => {
    const handler = new AdOptimizerHandler();
    const event = makeAnomalyEvent();
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

  describe("payload validation", () => {
    it("throws PayloadValidationError when campaignId is missing from anomaly event", async () => {
      const handler = new AdOptimizerHandler();
      const event = createEventEnvelope({
        organizationId: "org-1",
        eventType: "ad.anomaly_detected",
        source: { type: "system", id: "monitoring" },
        payload: { platform: "meta", metric: "ROAS" },
      });
      await expect(
        handler.handle(
          event,
          {},
          {
            organizationId: "org-1",
            profile: { ads: { connectedPlatforms: ["meta"] } },
          },
        ),
      ).rejects.toThrow(PayloadValidationError);
    });

    it("throws PayloadValidationError when amount is missing from attribution event", async () => {
      const handler = new AdOptimizerHandler();
      const event = createEventEnvelope({
        organizationId: "org-1",
        eventType: "revenue.attributed",
        source: { type: "agent", id: "revenue-tracker" },
        payload: { campaignId: "camp-1" },
      });
      await expect(
        handler.handle(
          event,
          {},
          {
            organizationId: "org-1",
            profile: { ads: { connectedPlatforms: ["meta"] } },
          },
        ),
      ).rejects.toThrow(PayloadValidationError);
    });
  });
});
