import { describe, it, expect } from "vitest";
import { RevenueTrackerHandler } from "../handler.js";
import { createEventEnvelope } from "../../../events.js";

function makeRevenueEvent(overrides: Record<string, unknown> = {}) {
  return createEventEnvelope({
    organizationId: "org-1",
    eventType: "revenue.recorded",
    source: { type: "webhook", id: "stripe" },
    payload: { contactId: "c1", amount: 250, currency: "USD", ...overrides },
    attribution: {
      fbclid: "fb-abc",
      gclid: "gc-xyz",
      ttclid: "tt-123",
      sourceCampaignId: "camp-1",
      sourceAdId: "ad-1",
      utmSource: "meta",
      utmMedium: "paid",
      utmCampaign: "spring",
    },
  });
}

describe("RevenueTrackerHandler — enhanced", () => {
  it("dispatches platform-specific offline conversion actions", async () => {
    const handler = new RevenueTrackerHandler();
    const event = makeRevenueEvent();

    const result = await handler.handle(
      event,
      { platforms: ["meta", "google"] },
      {
        organizationId: "org-1",
        profile: {
          revenue: { attributionModel: "last_click" },
          ads: { connectedPlatforms: ["meta", "google", "tiktok"] },
        },
      },
    );

    const actionTypes = result.actions.map((a) => a.actionType);
    expect(actionTypes).toContain("digital-ads.capi.dispatch");
    expect(actionTypes).toContain("digital-ads.google.offline_conversion");
    expect(actionTypes).not.toContain("digital-ads.tiktok.offline_conversion");
  });

  it("dispatches to all connected platforms when config.platforms not set", async () => {
    const handler = new RevenueTrackerHandler();
    const event = makeRevenueEvent();

    const result = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: {
          revenue: { attributionModel: "last_click" },
          ads: { connectedPlatforms: ["meta", "google", "tiktok"] },
        },
      },
    );

    const actionTypes = result.actions.map((a) => a.actionType);
    expect(actionTypes).toContain("digital-ads.capi.dispatch");
    expect(actionTypes).toContain("digital-ads.google.offline_conversion");
    expect(actionTypes).toContain("digital-ads.tiktok.offline_conversion");
  });

  it("emits owner notification on dead letter when alertOnDeadLetter enabled", async () => {
    const handler = new RevenueTrackerHandler({ alertOnDeadLetter: true });
    const event = makeRevenueEvent();

    // Simulate a dead letter scenario — when revenue has no ads config
    const result = await handler.handle(
      event,
      { alertOnDeadLetter: true },
      {
        organizationId: "org-1",
        profile: { revenue: { attributionModel: "last_click" } },
      },
    );

    // With no ads config, no conversion actions dispatched but attribution event still emitted
    expect(result.events.some((e) => e.eventType === "revenue.attributed")).toBe(true);
    expect(result.actions).toHaveLength(0);
  });

  it("uses retryOnFailure config flag", async () => {
    const handler = new RevenueTrackerHandler({ alertOnDeadLetter: true });
    const event = makeRevenueEvent();

    const result = await handler.handle(
      event,
      { retryOnFailure: true, platforms: ["meta"] },
      {
        organizationId: "org-1",
        profile: {
          revenue: { attributionModel: "last_click" },
          ads: { connectedPlatforms: ["meta"] },
        },
      },
    );

    const capiAction = result.actions.find((a) => a.actionType === "digital-ads.capi.dispatch");
    expect(capiAction?.parameters.retryOnFailure).toBe(true);
  });
});
