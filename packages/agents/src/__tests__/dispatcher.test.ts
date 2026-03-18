import { describe, it, expect, vi } from "vitest";
import { Dispatcher } from "../dispatcher.js";
import { InMemoryDeliveryStore } from "../delivery-store.js";
import { PolicyBridge } from "../policy-bridge.js";
import { createEventEnvelope } from "../events.js";
import { AgentStateTracker } from "../agent-state.js";
import type { RoutePlan } from "../route-plan.js";

describe("Dispatcher", () => {
  it("dispatches to agent destination and records success", async () => {
    const store = new InMemoryDeliveryStore();
    const bridge = new PolicyBridge(null);
    const agentHandler = vi.fn().mockResolvedValue({ success: true });

    const dispatcher = new Dispatcher({
      deliveryStore: store,
      policyBridge: bridge,
      handlers: { agent: agentHandler },
    });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "webhook", id: "telegram" },
      payload: { contactId: "c1" },
    });

    const plan: RoutePlan = {
      event,
      destinations: [
        { type: "agent", id: "lead-responder", criticality: "required", sequencing: "parallel" },
      ],
    };

    const results = await dispatcher.execute(plan);
    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe("succeeded");
    expect(agentHandler).toHaveBeenCalledWith(event, "lead-responder");
  });

  it("records failure when handler throws", async () => {
    const store = new InMemoryDeliveryStore();
    const bridge = new PolicyBridge(null);
    const agentHandler = vi.fn().mockRejectedValue(new Error("Agent offline"));

    const dispatcher = new Dispatcher({
      deliveryStore: store,
      policyBridge: bridge,
      handlers: { agent: agentHandler },
    });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "webhook", id: "telegram" },
      payload: {},
    });

    const plan: RoutePlan = {
      event,
      destinations: [
        { type: "agent", id: "lead-responder", criticality: "required", sequencing: "parallel" },
      ],
    };

    const results = await dispatcher.execute(plan);
    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe("failed");
    expect(results[0]!.error).toBe("Agent offline");
  });

  it("skips destinations blocked by policy", async () => {
    const store = new InMemoryDeliveryStore();
    const bridge = new PolicyBridge({
      evaluate: vi.fn().mockResolvedValue({ effect: "deny", reason: "no consent" }),
    });
    const agentHandler = vi.fn();

    const dispatcher = new Dispatcher({
      deliveryStore: store,
      policyBridge: bridge,
      handlers: { agent: agentHandler },
    });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "reminder.send",
      source: { type: "agent", id: "nurture" },
      payload: {},
    });

    const plan: RoutePlan = {
      event,
      destinations: [
        { type: "agent", id: "nurture", criticality: "required", sequencing: "parallel" },
      ],
    };

    const results = await dispatcher.execute(plan);
    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe("blocked_by_policy");
    expect(agentHandler).not.toHaveBeenCalled();
  });

  it("dispatches to multiple destinations in parallel", async () => {
    const store = new InMemoryDeliveryStore();
    const bridge = new PolicyBridge(null);
    const agentHandler = vi.fn().mockResolvedValue({ success: true });
    const webhookHandler = vi.fn().mockResolvedValue({ success: true });

    const dispatcher = new Dispatcher({
      deliveryStore: store,
      policyBridge: bridge,
      handlers: { agent: agentHandler, webhook: webhookHandler },
    });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "webhook", id: "telegram" },
      payload: {},
    });

    const plan: RoutePlan = {
      event,
      destinations: [
        { type: "agent", id: "lead-responder", criticality: "required", sequencing: "parallel" },
        {
          type: "webhook",
          id: "analytics-hook",
          criticality: "best_effort",
          sequencing: "parallel",
        },
      ],
    };

    const results = await dispatcher.execute(plan);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === "succeeded")).toBe(true);
  });

  it("updates agent state tracker when dispatching to agents", async () => {
    const stateTracker = new AgentStateTracker();
    const dispatcher = new Dispatcher({
      deliveryStore: new InMemoryDeliveryStore(),
      policyBridge: new PolicyBridge(null),
      handlers: {
        agent: vi.fn().mockResolvedValue({ success: true }),
      },
      stateTracker,
    });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "system", id: "test" },
      payload: {},
    });

    const plan: RoutePlan = {
      event,
      destinations: [
        { type: "agent", id: "lead-responder", criticality: "required", sequencing: "parallel" },
      ],
    };

    await dispatcher.execute(plan);

    const state = stateTracker.get("org-1", "lead-responder")!;
    expect(state.activityStatus).toBe("idle");
    expect(state.eventsProcessed).toBe(1);
    expect(state.lastActionSummary).toContain("lead.received");
  });

  it("sets error state when agent handler fails", async () => {
    const stateTracker = new AgentStateTracker();
    const dispatcher = new Dispatcher({
      deliveryStore: new InMemoryDeliveryStore(),
      policyBridge: new PolicyBridge(null),
      handlers: {
        agent: vi.fn().mockRejectedValue(new Error("handler crashed")),
      },
      stateTracker,
    });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "system", id: "test" },
      payload: {},
    });

    const plan: RoutePlan = {
      event,
      destinations: [
        { type: "agent", id: "lead-responder", criticality: "required", sequencing: "parallel" },
      ],
    };

    await dispatcher.execute(plan);

    const state = stateTracker.get("org-1", "lead-responder")!;
    expect(state.activityStatus).toBe("error");
    expect(state.lastError).toBe("handler crashed");
  });
});
