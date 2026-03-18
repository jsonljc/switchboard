import { describe, it, expect, vi } from "vitest";
import { NurtureAgentHandler } from "../handler.js";
import { createEventEnvelope } from "../../../events.js";
import type { NurtureAgentDeps } from "../types.js";

function makeDisqualifiedEvent(payload: Record<string, unknown> = {}) {
  return createEventEnvelope({
    organizationId: "org-1",
    eventType: "lead.disqualified",
    source: { type: "agent", id: "lead-responder" },
    payload: {
      contactId: "c1",
      score: 20,
      tier: "cold",
      reason: "below_threshold",
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

function makeStageAdvancedEvent(payload: Record<string, unknown> = {}) {
  return createEventEnvelope({
    organizationId: "org-1",
    eventType: "stage.advanced",
    source: { type: "agent", id: "sales-closer" },
    payload: {
      contactId: "c1",
      stage: "booking_initiated",
      ...payload,
    },
  });
}

function makeRevenueRecordedEvent(payload: Record<string, unknown> = {}) {
  return createEventEnvelope({
    organizationId: "org-1",
    eventType: "revenue.recorded",
    source: { type: "system", id: "payments" },
    payload: {
      contactId: "c1",
      amount: 150,
      ...payload,
    },
  });
}

describe("NurtureAgentHandler", () => {
  // --- lead.disqualified ---

  it("starts cold nurture cadence on lead.disqualified", async () => {
    const handler = new NurtureAgentHandler();
    const event = makeDisqualifiedEvent();

    const response = await handler.handle(event, {}, { organizationId: "org-1" });

    expect(response.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionType: "customer-engagement.cadence.start",
          parameters: expect.objectContaining({
            contactId: "c1",
            cadenceType: "cold_nurture",
          }),
        }),
      ]),
    );
  });

  it("skips cadence start if contact already has active cadence", async () => {
    const deps: NurtureAgentDeps = {
      getCadenceStatus: vi.fn().mockReturnValue({
        active: true,
        cadenceId: "cad-1",
        currentStep: 2,
        totalSteps: 5,
      }),
    };
    const handler = new NurtureAgentHandler(deps);
    const event = makeDisqualifiedEvent();

    const response = await handler.handle(event, {}, { organizationId: "org-1" });

    expect(response.events).toHaveLength(0);
    expect(response.actions).toHaveLength(0);
  });

  it("starts cadence when getCadenceStatus returns null", async () => {
    const deps: NurtureAgentDeps = {
      getCadenceStatus: vi.fn().mockReturnValue(null),
    };
    const handler = new NurtureAgentHandler(deps);
    const event = makeDisqualifiedEvent();

    const response = await handler.handle(event, {}, { organizationId: "org-1" });

    expect(response.actions).toHaveLength(1);
    expect(response.actions[0]!.actionType).toBe("customer-engagement.cadence.start");
  });

  it("starts cadence when getCadenceStatus returns inactive", async () => {
    const deps: NurtureAgentDeps = {
      getCadenceStatus: vi.fn().mockReturnValue({
        active: false,
        cadenceId: "cad-old",
        currentStep: 5,
        totalSteps: 5,
      }),
    };
    const handler = new NurtureAgentHandler(deps);
    const event = makeDisqualifiedEvent();

    const response = await handler.handle(event, {}, { organizationId: "org-1" });

    expect(response.actions).toHaveLength(1);
    expect(response.actions[0]!.actionType).toBe("customer-engagement.cadence.start");
  });

  it("re-qualifies lead when LTV tier is high", async () => {
    const deps: NurtureAgentDeps = {
      scoreLtv: vi.fn().mockReturnValue({ score: 90, tier: "high" }),
    };
    const handler = new NurtureAgentHandler(deps);
    const event = makeDisqualifiedEvent();

    const response = await handler.handle(event, {}, { organizationId: "org-1" });

    const qualifiedEvent = response.events.find((e) => e.eventType === "lead.qualified");
    expect(qualifiedEvent).toBeDefined();
    expect(qualifiedEvent!.payload).toEqual(
      expect.objectContaining({
        contactId: "c1",
        score: 90,
        tier: "high",
        reason: "high_ltv_requalification",
      }),
    );
  });

  it("does not re-qualify when LTV tier is not high", async () => {
    const deps: NurtureAgentDeps = {
      scoreLtv: vi.fn().mockReturnValue({ score: 30, tier: "low" }),
    };
    const handler = new NurtureAgentHandler(deps);
    const event = makeDisqualifiedEvent();

    const response = await handler.handle(event, {}, { organizationId: "org-1" });

    expect(response.events.find((e) => e.eventType === "lead.qualified")).toBeUndefined();
    // Still starts cadence
    expect(response.actions).toHaveLength(1);
  });

  it("forwards attribution chain on lead.qualified event", async () => {
    const deps: NurtureAgentDeps = {
      scoreLtv: vi.fn().mockReturnValue({ score: 95, tier: "high" }),
    };
    const handler = new NurtureAgentHandler(deps);
    const event = makeDisqualifiedEvent();

    const response = await handler.handle(event, {}, { organizationId: "org-1" });

    const qualifiedEvent = response.events.find((e) => e.eventType === "lead.qualified");
    expect(qualifiedEvent!.attribution).toBeDefined();
    expect(qualifiedEvent!.attribution!.fbclid).toBe("fb-abc");
    expect(qualifiedEvent!.attribution!.sourceCampaignId).toBe("camp-1");
  });

  it("sets causationId to inbound event id on lead.disqualified", async () => {
    const deps: NurtureAgentDeps = {
      scoreLtv: vi.fn().mockReturnValue({ score: 95, tier: "high" }),
    };
    const handler = new NurtureAgentHandler(deps);
    const event = makeDisqualifiedEvent();

    const response = await handler.handle(event, {}, { organizationId: "org-1" });

    const qualifiedEvent = response.events.find((e) => e.eventType === "lead.qualified");
    expect(qualifiedEvent!.causationId).toBe(event.eventId);
    expect(qualifiedEvent!.correlationId).toBe(event.correlationId);
  });

  // --- stage.advanced ---

  it("sends reminder on stage.advanced", async () => {
    const handler = new NurtureAgentHandler();
    const event = makeStageAdvancedEvent();

    const response = await handler.handle(event, {}, { organizationId: "org-1" });

    expect(response.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionType: "customer-engagement.reminder.send",
          parameters: expect.objectContaining({
            contactId: "c1",
          }),
        }),
      ]),
    );
  });

  it("includes stage name in reminder message", async () => {
    const handler = new NurtureAgentHandler();
    const event = makeStageAdvancedEvent({ stage: "payment_pending" });

    const response = await handler.handle(event, {}, { organizationId: "org-1" });

    const reminderAction = response.actions.find(
      (a) => a.actionType === "customer-engagement.reminder.send",
    );
    expect(reminderAction!.parameters.message).toContain("payment_pending");
  });

  // --- revenue.recorded ---

  it("requests review on revenue.recorded", async () => {
    const handler = new NurtureAgentHandler();
    const event = makeRevenueRecordedEvent();

    const response = await handler.handle(event, {}, { organizationId: "org-1" });

    expect(response.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionType: "customer-engagement.review.request",
          parameters: expect.objectContaining({
            contactId: "c1",
          }),
        }),
      ]),
    );
  });

  it("uses platform from payload for review request", async () => {
    const handler = new NurtureAgentHandler();
    const event = makeRevenueRecordedEvent({ platform: "yelp" });

    const response = await handler.handle(event, {}, { organizationId: "org-1" });

    const reviewAction = response.actions.find(
      (a) => a.actionType === "customer-engagement.review.request",
    );
    expect(reviewAction!.parameters.platform).toBe("yelp");
  });

  it("defaults platform to google when not specified", async () => {
    const handler = new NurtureAgentHandler();
    const event = makeRevenueRecordedEvent();

    const response = await handler.handle(event, {}, { organizationId: "org-1" });

    const reviewAction = response.actions.find(
      (a) => a.actionType === "customer-engagement.review.request",
    );
    expect(reviewAction!.parameters.platform).toBe("google");
  });

  // --- unknown events ---

  it("ignores unknown event types", async () => {
    const handler = new NurtureAgentHandler();

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "ad.optimized",
      source: { type: "system", id: "test" },
      payload: {},
    });

    const response = await handler.handle(event, {}, { organizationId: "org-1" });
    expect(response.events).toHaveLength(0);
    expect(response.actions).toHaveLength(0);
  });

  // --- state ---

  it("preserves handler state on lead.disqualified", async () => {
    const handler = new NurtureAgentHandler();
    const event = makeDisqualifiedEvent();

    const response = await handler.handle(event, {}, { organizationId: "org-1" });

    expect(response.state).toEqual({
      contactId: "c1",
      cadenceStarted: "cold_nurture",
    });
  });

  it("preserves handler state on stage.advanced", async () => {
    const handler = new NurtureAgentHandler();
    const event = makeStageAdvancedEvent({ stage: "booking_initiated" });

    const response = await handler.handle(event, {}, { organizationId: "org-1" });

    expect(response.state).toEqual({
      contactId: "c1",
      reminderSent: true,
      stage: "booking_initiated",
    });
  });

  it("preserves handler state on revenue.recorded", async () => {
    const handler = new NurtureAgentHandler();
    const event = makeRevenueRecordedEvent();

    const response = await handler.handle(event, {}, { organizationId: "org-1" });

    expect(response.state).toEqual({
      contactId: "c1",
      reviewRequested: true,
      platform: "google",
    });
  });

  // --- backward compatibility ---

  it("works without deps (backward compatible)", async () => {
    const handler = new NurtureAgentHandler();
    const event = makeDisqualifiedEvent();

    const response = await handler.handle(event, {}, { organizationId: "org-1" });

    expect(response.actions).toHaveLength(1);
    expect(response.actions[0]!.actionType).toBe("customer-engagement.cadence.start");
  });
});
