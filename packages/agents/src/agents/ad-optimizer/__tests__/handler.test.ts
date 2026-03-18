import { describe, it, expect, vi } from "vitest";
import { AdOptimizerHandler } from "../handler.js";
import { createEventEnvelope } from "../../../events.js";
import type { AgentContext } from "../../../ports.js";

function makeEvent(overrides: Record<string, unknown> = {}) {
  return createEventEnvelope({
    organizationId: "org-1",
    eventType: "revenue.attributed",
    source: { type: "agent", id: "attribution-tracker" },
    payload: {
      campaignId: "camp-1",
      platform: "meta",
      entityId: "ent-1",
      revenue: 500,
      ...overrides,
    },
  });
}

const defaultContext: AgentContext = { organizationId: "org-1" };

describe("AdOptimizerHandler", () => {
  it("ignores non revenue.attributed events", async () => {
    const handler = new AdOptimizerHandler();
    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "agent", id: "test" },
      payload: {},
    });
    const result = await handler.handle(event, {}, defaultContext);
    expect(result.events).toHaveLength(0);
    expect(result.actions).toHaveLength(0);
  });

  it("emits ad.optimized event even without snapshot", async () => {
    const handler = new AdOptimizerHandler();
    const event = makeEvent();
    const result = await handler.handle(event, {}, defaultContext);

    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.eventType).toBe("ad.optimized");
    expect(result.actions).toHaveLength(0);
    expect(result.state).toBeDefined();
    expect(result.state?.optimizationAction).toBe("none");
  });

  it("pauses campaign when ROAS is zero (spend > 0, revenue = 0)", async () => {
    const fetchSnapshot = vi.fn().mockResolvedValue({
      spend: 100,
      revenue: 0,
      conversions: 0,
    });
    const handler = new AdOptimizerHandler({ fetchSnapshot });
    const event = makeEvent();
    const result = await handler.handle(event, {}, defaultContext);

    expect(fetchSnapshot).toHaveBeenCalledWith({ platform: "meta", entityId: "ent-1" });
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]!.actionType).toBe("digital-ads.campaign.pause");
    expect(result.actions[0]!.parameters).toEqual({ campaignId: "camp-1" });
    expect(result.state?.optimizationAction).toBe("pause");
  });

  it("adjusts budget when ROAS is below target", async () => {
    const fetchSnapshot = vi.fn().mockResolvedValue({
      spend: 100,
      revenue: 200,
      conversions: 5,
    });
    const handler = new AdOptimizerHandler({ fetchSnapshot });
    const event = makeEvent();
    // ROAS = 200/100 = 2.0, target = 4.0 → reduce budget
    const result = await handler.handle(event, { targetROAS: 4.0 }, defaultContext);

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]!.actionType).toBe("digital-ads.campaign.adjust_budget");
    expect(result.actions[0]!.parameters.campaignId).toBe("camp-1");
    expect(typeof result.actions[0]!.parameters.newBudget).toBe("number");
    expect(result.actions[0]!.parameters.newBudget as number).toBeLessThan(100);
    expect(result.state?.optimizationAction).toBe("adjust_budget");
  });

  it("takes no action when ROAS meets target", async () => {
    const fetchSnapshot = vi.fn().mockResolvedValue({
      spend: 100,
      revenue: 500,
      conversions: 10,
    });
    const handler = new AdOptimizerHandler({ fetchSnapshot });
    const event = makeEvent();
    // ROAS = 500/100 = 5.0, target = 4.0 → no action
    const result = await handler.handle(event, { targetROAS: 4.0 }, defaultContext);

    expect(result.actions).toHaveLength(0);
    expect(result.state?.optimizationAction).toBe("none");
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.eventType).toBe("ad.optimized");
  });

  it("respects maxBudgetChangePercent config", async () => {
    const fetchSnapshot = vi.fn().mockResolvedValue({
      spend: 100,
      revenue: 100,
      conversions: 2,
    });
    const handler = new AdOptimizerHandler({ fetchSnapshot });
    const event = makeEvent();
    // ROAS = 1.0, target = 4.0, maxBudgetChangePercent = 10
    // Desired reduction = ((4-1)/4)*100 = 75%, capped at 10%
    const result = await handler.handle(
      event,
      { targetROAS: 4.0, maxBudgetChangePercent: 10 },
      defaultContext,
    );

    expect(result.actions).toHaveLength(1);
    const newBudget = result.actions[0]!.parameters.newBudget as number;
    // With 10% max reduction from spend of 100, new budget should be 90
    expect(newBudget).toBe(90);
  });

  it("uses default config values when not provided", async () => {
    const fetchSnapshot = vi.fn().mockResolvedValue({
      spend: 100,
      revenue: 200,
      conversions: 3,
    });
    const handler = new AdOptimizerHandler({ fetchSnapshot });
    const event = makeEvent();
    // ROAS = 2.0, default target = 4.0, default maxBudgetChangePercent = 20
    const result = await handler.handle(event, {}, defaultContext);

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]!.actionType).toBe("digital-ads.campaign.adjust_budget");
  });

  it("sets correlationId and causationId on emitted events", async () => {
    const handler = new AdOptimizerHandler();
    const event = makeEvent();
    const result = await handler.handle(event, {}, defaultContext);

    expect(result.events[0]!.correlationId).toBe(event.correlationId);
    expect(result.events[0]!.causationId).toBe(event.eventId);
  });

  it("includes snapshot in state when available", async () => {
    const snapshot = { spend: 100, revenue: 500, conversions: 10 };
    const fetchSnapshot = vi.fn().mockResolvedValue(snapshot);
    const handler = new AdOptimizerHandler({ fetchSnapshot });
    const event = makeEvent();
    const result = await handler.handle(event, {}, defaultContext);

    expect(result.state?.snapshot).toEqual(snapshot);
  });

  it("constructs with empty deps by default", () => {
    const handler = new AdOptimizerHandler();
    expect(handler).toBeInstanceOf(AdOptimizerHandler);
  });
});
