import { describe, it, expect, vi } from "vitest";
import { EventLoop } from "../event-loop.js";
import { AgentRegistry } from "../registry.js";
import { AgentRouter } from "../router.js";
import { PolicyBridge } from "../policy-bridge.js";
import { InMemoryDeliveryStore } from "../delivery-store.js";
import { HandlerRegistry } from "../handler-registry.js";
import { ActionExecutor } from "../action-executor.js";
import { AgentStateTracker } from "../agent-state.js";
import { createEventEnvelope } from "../events.js";
import type { AgentHandler, AgentContext, AgentResponse } from "../ports.js";
import type { RoutedEventEnvelope } from "../events.js";

function makeHandler(fn: (event: RoutedEventEnvelope) => AgentResponse): AgentHandler {
  return {
    handle: vi.fn(
      async (event: RoutedEventEnvelope, _config: Record<string, unknown>, _ctx: AgentContext) =>
        fn(event),
    ),
  };
}

function setupRegistry(): AgentRegistry {
  const registry = new AgentRegistry();
  registry.register("org-1", {
    agentId: "lead-responder",
    version: "0.1.0",
    installed: true,
    status: "active",
    config: {},
    capabilities: {
      accepts: ["lead.received"],
      emits: ["lead.qualified"],
      tools: [],
    },
  });
  registry.register("org-1", {
    agentId: "sales-closer",
    version: "0.1.0",
    installed: true,
    status: "active",
    config: {},
    capabilities: {
      accepts: ["lead.qualified"],
      emits: ["stage.advanced"],
      tools: [],
    },
  });
  return registry;
}

describe("EventLoop", () => {
  it("chains lead.received → lead-responder → lead.qualified → sales-closer", async () => {
    const agentRegistry = setupRegistry();
    const handlerRegistry = new HandlerRegistry();

    handlerRegistry.register(
      "lead-responder",
      makeHandler((event) => ({
        events: [
          createEventEnvelope({
            organizationId: event.organizationId,
            eventType: "lead.qualified",
            source: { type: "agent", id: "lead-responder" },
            payload: { contactId: "c1", score: 80 },
            correlationId: event.correlationId,
            causationId: event.eventId,
          }),
        ],
        actions: [],
      })),
    );

    handlerRegistry.register(
      "sales-closer",
      makeHandler((_event) => ({
        events: [],
        actions: [
          {
            actionType: "customer-engagement.appointment.book",
            parameters: { contactId: "c1" },
          },
        ],
      })),
    );

    const actionExecutor = new ActionExecutor();
    const bookHandler = vi.fn().mockResolvedValue({ success: true });
    actionExecutor.register("customer-engagement.appointment.book", bookHandler);

    const loop = new EventLoop({
      router: new AgentRouter(agentRegistry),
      registry: agentRegistry,
      handlers: handlerRegistry,
      actionExecutor,
      policyBridge: new PolicyBridge(null),
      deliveryStore: new InMemoryDeliveryStore(),
    });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "webhook", id: "telegram" },
      payload: { contactId: "c1" },
    });

    const result = await loop.process(event, { organizationId: "org-1" });

    expect(result.processed).toHaveLength(2);
    expect(result.processed[0]!.agentId).toBe("lead-responder");
    expect(result.processed[0]!.outputEvents).toEqual(["lead.qualified"]);
    expect(result.processed[1]!.agentId).toBe("sales-closer");
    expect(result.processed[1]!.actionsExecuted).toEqual(["customer-engagement.appointment.book"]);

    expect(bookHandler).toHaveBeenCalledWith({ contactId: "c1" }, { organizationId: "org-1" });
  });

  it("stops at max depth to prevent infinite loops", async () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.register("org-1", {
      agentId: "echo-agent",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: {
        accepts: ["ping"],
        emits: ["ping"],
        tools: [],
      },
    });

    const handlerRegistry = new HandlerRegistry();
    handlerRegistry.register(
      "echo-agent",
      makeHandler((event) => ({
        events: [
          createEventEnvelope({
            organizationId: event.organizationId,
            eventType: "ping",
            source: { type: "agent", id: "echo-agent" },
            payload: {},
            correlationId: event.correlationId,
          }),
        ],
        actions: [],
      })),
    );

    const loop = new EventLoop({
      router: new AgentRouter(agentRegistry),
      registry: agentRegistry,
      handlers: handlerRegistry,
      actionExecutor: new ActionExecutor(),
      policyBridge: new PolicyBridge(null),
      deliveryStore: new InMemoryDeliveryStore(),
      maxDepth: 3,
    });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "ping",
      source: { type: "system", id: "test" },
      payload: {},
    });

    const result = await loop.process(event, { organizationId: "org-1" });

    expect(result.processed.length).toBeLessThanOrEqual(3);
    expect(result.depth).toBeLessThanOrEqual(3);
  });

  it("skips scheduled agents for non-urgent events", async () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.register("org-1", {
      agentId: "ad-optimizer",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: {
        accepts: ["revenue.attributed"],
        emits: ["ad.optimized"],
        tools: [],
      },
      executionMode: "hybrid",
    });

    const handlerRegistry = new HandlerRegistry();
    const handler = makeHandler(() => ({ events: [], actions: [] }));
    handlerRegistry.register("ad-optimizer", handler);

    const loop = new EventLoop({
      router: new AgentRouter(agentRegistry),
      registry: agentRegistry,
      handlers: handlerRegistry,
      actionExecutor: new ActionExecutor(),
      policyBridge: new PolicyBridge(null),
      deliveryStore: new InMemoryDeliveryStore(),
    });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "revenue.attributed",
      source: { type: "agent", id: "revenue-tracker" },
      payload: {},
    });

    const result = await loop.process(event, { organizationId: "org-1" });

    expect(result.processed).toHaveLength(0);
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it("routes urgent events to hybrid agents", async () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.register("org-1", {
      agentId: "ad-optimizer",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: {
        accepts: ["ad.anomaly_detected"],
        emits: [],
        tools: [],
      },
      executionMode: "hybrid",
    });

    const handlerRegistry = new HandlerRegistry();
    const handler = makeHandler(() => ({ events: [], actions: [] }));
    handlerRegistry.register("ad-optimizer", handler);

    const loop = new EventLoop({
      router: new AgentRouter(agentRegistry),
      registry: agentRegistry,
      handlers: handlerRegistry,
      actionExecutor: new ActionExecutor(),
      policyBridge: new PolicyBridge(null),
      deliveryStore: new InMemoryDeliveryStore(),
    });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "ad.anomaly_detected",
      source: { type: "agent", id: "revenue-tracker" },
      payload: { reason: "spend_spike" },
    });

    const result = await loop.process(event, { organizationId: "org-1" });

    expect(result.processed).toHaveLength(1);
    expect(result.processed[0]!.agentId).toBe("ad-optimizer");
  });

  it("updates state tracker during processing", async () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.register("org-1", {
      agentId: "lead-responder",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: { accepts: ["lead.received"], emits: [], tools: [] },
    });

    const handlerRegistry = new HandlerRegistry();
    handlerRegistry.register(
      "lead-responder",
      makeHandler(() => ({ events: [], actions: [] })),
    );

    const stateTracker = new AgentStateTracker();

    const loop = new EventLoop({
      router: new AgentRouter(agentRegistry),
      registry: agentRegistry,
      handlers: handlerRegistry,
      actionExecutor: new ActionExecutor(),
      policyBridge: new PolicyBridge(null),
      deliveryStore: new InMemoryDeliveryStore(),
      stateTracker,
    });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "system", id: "test" },
      payload: {},
    });

    await loop.process(event, { organizationId: "org-1" });

    const state = stateTracker.get("org-1", "lead-responder")!;
    expect(state.activityStatus).toBe("idle");
    expect(state.eventsProcessed).toBe(1);
  });

  it("records handler errors without crashing the loop", async () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.register("org-1", {
      agentId: "broken-agent",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: { accepts: ["lead.received"], emits: [], tools: [] },
    });

    const handlerRegistry = new HandlerRegistry();
    handlerRegistry.register("broken-agent", {
      handle: vi.fn().mockRejectedValue(new Error("handler crashed")),
    });

    const stateTracker = new AgentStateTracker();

    const loop = new EventLoop({
      router: new AgentRouter(agentRegistry),
      registry: agentRegistry,
      handlers: handlerRegistry,
      actionExecutor: new ActionExecutor(),
      policyBridge: new PolicyBridge(null),
      deliveryStore: new InMemoryDeliveryStore(),
      stateTracker,
    });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "system", id: "test" },
      payload: {},
    });

    const result = await loop.process(event, { organizationId: "org-1" });

    expect(result.processed).toHaveLength(1);
    expect(result.processed[0]!.success).toBe(false);
    expect(result.processed[0]!.error).toBe("handler crashed");

    const state = stateTracker.get("org-1", "broken-agent")!;
    expect(state.activityStatus).toBe("error");
  });
});
