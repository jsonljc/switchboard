import { describe, it, expect, vi } from "vitest";
import { Dispatcher } from "../dispatcher.js";
import { InMemoryDeliveryStore } from "../delivery-store.js";
import type { DeliveryStore } from "../delivery-store.js";
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

  describe("sequencing modes", () => {
    it("executes blocking destinations before parallel ones", async () => {
      const store = new InMemoryDeliveryStore();
      const bridge = new PolicyBridge(null);
      const executionOrder: string[] = [];

      const agentHandler = vi.fn().mockImplementation(async (_event, destinationId) => {
        executionOrder.push(destinationId);
        // Add a small delay to make timing more predictable
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { success: true };
      });

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
          {
            type: "agent",
            id: "parallel-agent",
            criticality: "optional",
            sequencing: "parallel",
          },
          {
            type: "agent",
            id: "blocking-agent",
            criticality: "required",
            sequencing: "blocking",
          },
        ],
      };

      const results = await dispatcher.execute(plan);
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.status === "succeeded")).toBe(true);

      // Blocking should execute before parallel
      expect(executionOrder[0]).toBe("blocking-agent");
      expect(executionOrder[1]).toBe("parallel-agent");
    });

    it("skips all remaining destinations when required blocking destination fails", async () => {
      const store = new InMemoryDeliveryStore();
      const bridge = new PolicyBridge(null);
      const agentHandler = vi.fn().mockImplementation(async (_event, destinationId) => {
        if (destinationId === "blocking-agent") {
          throw new Error("Blocking agent failed");
        }
        return { success: true };
      });

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
          {
            type: "agent",
            id: "blocking-agent",
            criticality: "required",
            sequencing: "blocking",
          },
          {
            type: "agent",
            id: "parallel-agent",
            criticality: "optional",
            sequencing: "parallel",
          },
          {
            type: "agent",
            id: "after-agent",
            criticality: "optional",
            sequencing: "after_success",
            afterDestinationId: "blocking-agent",
          },
        ],
      };

      const results = await dispatcher.execute(plan);
      expect(results).toHaveLength(3);

      const blockingResult = results.find((r) => r.destinationId === "blocking-agent");
      expect(blockingResult!.status).toBe("failed");
      expect(blockingResult!.error).toBe("Blocking agent failed");

      const parallelResult = results.find((r) => r.destinationId === "parallel-agent");
      expect(parallelResult!.status).toBe("skipped");
      expect(parallelResult!.skippedReason).toContain("Required blocking destination");

      const afterResult = results.find((r) => r.destinationId === "after-agent");
      expect(afterResult!.status).toBe("skipped");

      // Only the blocking agent should have been called
      expect(agentHandler).toHaveBeenCalledTimes(1);
    });

    it("continues with other destinations when optional blocking destination fails", async () => {
      const store = new InMemoryDeliveryStore();
      const bridge = new PolicyBridge(null);
      const agentHandler = vi.fn().mockImplementation(async (_event, destinationId) => {
        if (destinationId === "blocking-agent") {
          throw new Error("Blocking agent failed");
        }
        return { success: true };
      });

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
          {
            type: "agent",
            id: "blocking-agent",
            criticality: "optional",
            sequencing: "blocking",
          },
          {
            type: "agent",
            id: "parallel-agent",
            criticality: "optional",
            sequencing: "parallel",
          },
        ],
      };

      const results = await dispatcher.execute(plan);
      expect(results).toHaveLength(2);

      const blockingResult = results.find((r) => r.destinationId === "blocking-agent");
      expect(blockingResult!.status).toBe("failed");

      const parallelResult = results.find((r) => r.destinationId === "parallel-agent");
      expect(parallelResult!.status).toBe("succeeded");

      // Both agents should have been called
      expect(agentHandler).toHaveBeenCalledTimes(2);
    });

    it("executes after_success destination when dependency succeeds", async () => {
      const store = new InMemoryDeliveryStore();
      const bridge = new PolicyBridge(null);
      const executionOrder: string[] = [];

      const agentHandler = vi.fn().mockImplementation(async (_event, destinationId) => {
        executionOrder.push(destinationId);
        return { success: true };
      });

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
          {
            type: "agent",
            id: "primary-agent",
            criticality: "required",
            sequencing: "parallel",
          },
          {
            type: "agent",
            id: "followup-agent",
            criticality: "optional",
            sequencing: "after_success",
            afterDestinationId: "primary-agent",
          },
        ],
      };

      const results = await dispatcher.execute(plan);
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.status === "succeeded")).toBe(true);

      // Primary should execute before followup
      expect(executionOrder[0]).toBe("primary-agent");
      expect(executionOrder[1]).toBe("followup-agent");
    });

    it("skips after_success destination when dependency fails", async () => {
      const store = new InMemoryDeliveryStore();
      const bridge = new PolicyBridge(null);
      const agentHandler = vi.fn().mockImplementation(async (_event, destinationId) => {
        if (destinationId === "primary-agent") {
          throw new Error("Primary agent failed");
        }
        return { success: true };
      });

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
          {
            type: "agent",
            id: "primary-agent",
            criticality: "optional",
            sequencing: "parallel",
          },
          {
            type: "agent",
            id: "followup-agent",
            criticality: "optional",
            sequencing: "after_success",
            afterDestinationId: "primary-agent",
          },
        ],
      };

      const results = await dispatcher.execute(plan);
      expect(results).toHaveLength(2);

      const primaryResult = results.find((r) => r.destinationId === "primary-agent");
      expect(primaryResult!.status).toBe("failed");

      const followupResult = results.find((r) => r.destinationId === "followup-agent");
      expect(followupResult!.status).toBe("skipped");
      expect(followupResult!.skippedReason).toContain("did not succeed");

      // Only the primary agent should have been called
      expect(agentHandler).toHaveBeenCalledTimes(1);
    });

    it("skips after_success destination when afterDestinationId is missing", async () => {
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
        payload: {},
      });

      const plan: RoutePlan = {
        event,
        destinations: [
          {
            type: "agent",
            id: "followup-agent",
            criticality: "optional",
            sequencing: "after_success",
            // Missing afterDestinationId
          },
        ],
      };

      const results = await dispatcher.execute(plan);
      expect(results).toHaveLength(1);

      const followupResult = results[0];
      expect(followupResult!.status).toBe("skipped");
      expect(followupResult!.skippedReason).toContain("Missing afterDestinationId");

      // Handler should not have been called
      expect(agentHandler).not.toHaveBeenCalled();
    });

    it("handles complex sequencing with multiple blocking and after_success destinations", async () => {
      const store = new InMemoryDeliveryStore();
      const bridge = new PolicyBridge(null);
      const executionOrder: string[] = [];
      const agentHandler = vi.fn().mockImplementation(async (_event, destinationId) => {
        executionOrder.push(destinationId);
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { success: true };
      });
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
          { type: "agent", id: "blocking-1", criticality: "required", sequencing: "blocking" },
          { type: "agent", id: "blocking-2", criticality: "optional", sequencing: "blocking" },
          { type: "agent", id: "parallel-1", criticality: "optional", sequencing: "parallel" },
          { type: "agent", id: "parallel-2", criticality: "optional", sequencing: "parallel" },
          {
            type: "agent",
            id: "after-parallel-1",
            criticality: "optional",
            sequencing: "after_success",
            afterDestinationId: "parallel-1",
          },
          {
            type: "agent",
            id: "after-blocking-1",
            criticality: "optional",
            sequencing: "after_success",
            afterDestinationId: "blocking-1",
          },
        ],
      };

      const results = await dispatcher.execute(plan);
      expect(results).toHaveLength(6);
      expect(results.every((r) => r.status === "succeeded")).toBe(true);

      // Blocking before parallel, after_success after their dependencies
      expect(executionOrder.indexOf("blocking-1")).toBeLessThan(
        executionOrder.indexOf("parallel-1"),
      );
      expect(executionOrder.indexOf("blocking-2")).toBeLessThan(
        executionOrder.indexOf("parallel-1"),
      );
      expect(executionOrder.indexOf("after-parallel-1")).toBeGreaterThan(
        executionOrder.indexOf("parallel-1"),
      );
      expect(executionOrder.indexOf("after-blocking-1")).toBeGreaterThan(
        executionOrder.indexOf("blocking-1"),
      );
    });
  });

  describe("resilience", () => {
    it("continues dispatching when one destination handler throws", async () => {
      const store = new InMemoryDeliveryStore();
      const bridge = new PolicyBridge(null);
      let callCount = 0;
      const agentHandler = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error("first handler exploded"));
        }
        return Promise.resolve({ success: true });
      });

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
          {
            type: "agent",
            id: "agent-a",
            criticality: "required",
            sequencing: "parallel",
          },
          {
            type: "agent",
            id: "agent-b",
            criticality: "required",
            sequencing: "parallel",
          },
        ],
      };

      const results = await dispatcher.execute(plan);
      expect(results).toHaveLength(2);

      const failed = results.find((r) => r.destinationId === "agent-a");
      const succeeded = results.find((r) => r.destinationId === "agent-b");
      expect(failed!.status).toBe("failed");
      expect(failed!.error).toBe("first handler exploded");
      expect(succeeded!.status).toBe("succeeded");
    });

    it("returns results even when delivery store record() throws", async () => {
      const throwingStore: DeliveryStore = {
        record: vi.fn().mockRejectedValue(new Error("store is down")),
        update: vi.fn().mockRejectedValue(new Error("store is down")),
        getByEvent: vi.fn().mockResolvedValue([]),
        listRetryable: vi.fn().mockResolvedValue([]),
        sweepDeadLetters: vi.fn().mockResolvedValue(0),
      };
      const bridge = new PolicyBridge(null);
      const agentHandler = vi.fn().mockResolvedValue({ success: true });

      const dispatcher = new Dispatcher({
        deliveryStore: throwingStore,
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
          {
            type: "agent",
            id: "lead-responder",
            criticality: "required",
            sequencing: "parallel",
          },
        ],
      };

      const results = await dispatcher.execute(plan);
      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe("succeeded");
    });
  });
});
