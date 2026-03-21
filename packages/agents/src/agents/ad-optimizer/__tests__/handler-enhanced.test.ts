import { describe, it, expect } from "vitest";
import { AdOptimizerHandler } from "../handler.js";
import { createEventEnvelope } from "../../../events.js";
import type { ROASRecord } from "../roas-tracker.js";

function makePerformanceReviewEvent() {
  return createEventEnvelope({
    organizationId: "org-1",
    eventType: "ad.performance_review",
    source: { type: "system", id: "scheduler" },
    payload: { triggeredBy: "schedule" },
  });
}

function makeAttributionEvent(amount = 300, campaignId = "camp-1") {
  return createEventEnvelope({
    organizationId: "org-1",
    eventType: "revenue.attributed",
    source: { type: "agent", id: "revenue-tracker" },
    payload: { amount, campaignId, attributionModel: "last_click" },
  });
}

describe("AdOptimizerHandler — enhanced", () => {
  it("dispatches budget.increase when ROAS consistently above target", async () => {
    const roasHistory: ROASRecord[] = Array.from({ length: 4 }, (_, i) => ({
      campaignId: "camp-1",
      platform: "meta",
      roas: 3.5,
      spend: 100,
      revenue: 350,
      timestamp: new Date(Date.now() - (3 - i) * 24 * 60 * 60 * 1000).toISOString(),
    }));

    const handler = new AdOptimizerHandler({ roasHistory });
    const event = makePerformanceReviewEvent();

    const result = await handler.handle(
      event,
      { platforms: ["meta"], targetROAS: 2.0 },
      {
        organizationId: "org-1",
        profile: { ads: { connectedPlatforms: ["meta"], anomalyThreshold: 30 } },
      },
    );

    expect(result.actions.some((a) => a.actionType === "digital-ads.budget.increase")).toBe(true);
  });

  it("requires owner approval when budget change exceeds approvalThreshold", async () => {
    const roasHistory: ROASRecord[] = Array.from({ length: 4 }, (_, i) => ({
      campaignId: "camp-1",
      platform: "meta",
      roas: 3.5,
      spend: 500,
      revenue: 1750,
      timestamp: new Date(Date.now() - (3 - i) * 24 * 60 * 60 * 1000).toISOString(),
    }));

    const handler = new AdOptimizerHandler({ roasHistory });
    const event = makePerformanceReviewEvent();

    const result = await handler.handle(
      event,
      { platforms: ["meta"], targetROAS: 2.0, approvalThreshold: 50 },
      {
        organizationId: "org-1",
        profile: { ads: { connectedPlatforms: ["meta"], anomalyThreshold: 30 } },
      },
    );

    expect(result.events.some((e) => e.eventType === "conversation.escalated")).toBe(true);
    const escalation = result.events.find((e) => e.eventType === "conversation.escalated");
    expect(escalation?.payload).toEqual(
      expect.objectContaining({ reason: "budget_approval_required" }),
    );
  });

  it("auto-executes budget change when below approvalThreshold", async () => {
    const roasHistory: ROASRecord[] = Array.from({ length: 4 }, (_, i) => ({
      campaignId: "camp-1",
      platform: "meta",
      roas: 3.5,
      spend: 20,
      revenue: 70,
      timestamp: new Date(Date.now() - (3 - i) * 24 * 60 * 60 * 1000).toISOString(),
    }));

    const handler = new AdOptimizerHandler({ roasHistory });
    const event = makePerformanceReviewEvent();

    const result = await handler.handle(
      event,
      { platforms: ["meta"], targetROAS: 2.0, approvalThreshold: 100 },
      {
        organizationId: "org-1",
        profile: { ads: { connectedPlatforms: ["meta"], anomalyThreshold: 30 } },
      },
    );

    expect(result.actions.some((a) => a.actionType === "digital-ads.budget.increase")).toBe(true);
    expect(result.events.some((e) => e.eventType === "conversation.escalated")).toBe(false);
  });

  it("records ROAS on revenue.attributed event", async () => {
    const roasHistory: ROASRecord[] = [];
    const handler = new AdOptimizerHandler({ roasHistory });
    const event = makeAttributionEvent(300, "camp-1");

    await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { ads: { connectedPlatforms: ["meta"] } },
      },
    );

    expect(roasHistory).toHaveLength(1);
    expect(roasHistory[0]!.campaignId).toBe("camp-1");
  });

  it("dispatches budget.decrease when ROAS consistently below target", async () => {
    const roasHistory: ROASRecord[] = Array.from({ length: 3 }, (_, i) => ({
      campaignId: "camp-1",
      platform: "meta",
      roas: 0.5,
      spend: 100,
      revenue: 50,
      timestamp: new Date(Date.now() - (2 - i) * 24 * 60 * 60 * 1000).toISOString(),
    }));

    const handler = new AdOptimizerHandler({ roasHistory });
    const event = makePerformanceReviewEvent();

    const result = await handler.handle(
      event,
      { platforms: ["meta"], targetROAS: 2.0 },
      {
        organizationId: "org-1",
        profile: { ads: { connectedPlatforms: ["meta"], anomalyThreshold: 30 } },
      },
    );

    expect(result.actions.some((a) => a.actionType === "digital-ads.budget.decrease")).toBe(true);
  });

  it("filters platforms based on config.platforms", async () => {
    const handler = new AdOptimizerHandler({});
    const event = makePerformanceReviewEvent();

    const result = await handler.handle(
      event,
      { platforms: ["google"] },
      {
        organizationId: "org-1",
        profile: { ads: { connectedPlatforms: ["meta", "google", "tiktok"] } },
      },
    );

    expect(result.actions.every((a) => a.parameters.platform === "google")).toBe(true);
  });
});
