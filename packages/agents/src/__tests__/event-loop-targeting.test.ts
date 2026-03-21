import { describe, it, expect, vi } from "vitest";
import { EventLoop } from "../event-loop.js";
import { AgentRegistry } from "../registry.js";
import { AgentRouter } from "../router.js";
import { PolicyBridge } from "../policy-bridge.js";
import { InMemoryDeliveryStore } from "../delivery-store.js";
import { HandlerRegistry } from "../handler-registry.js";
import { ActionExecutor } from "../action-executor.js";
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

describe("EventLoop targetAgentId Filtering", () => {
  it("routes message.received with targetAgentId: 'lead-responder' to only Lead Responder", async () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.register("org-1", {
      agentId: "lead-responder",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: {
        accepts: ["message.received"],
        emits: [],
        tools: [],
      },
    });
    agentRegistry.register("org-1", {
      agentId: "sales-closer",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: {
        accepts: ["message.received"],
        emits: [],
        tools: [],
      },
    });

    const handlerRegistry = new HandlerRegistry();
    const leadHandler = makeHandler(() => ({ events: [], actions: [] }));
    const salesHandler = makeHandler(() => ({ events: [], actions: [] }));
    handlerRegistry.register("lead-responder", leadHandler);
    handlerRegistry.register("sales-closer", salesHandler);

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
      eventType: "message.received",
      source: { type: "webhook", id: "whatsapp" },
      payload: { text: "hello" },
      metadata: { targetAgentId: "lead-responder" },
    });

    const result = await loop.process(event, { organizationId: "org-1" });

    expect(result.processed).toHaveLength(1);
    expect(result.processed[0]!.agentId).toBe("lead-responder");
    expect(leadHandler.handle).toHaveBeenCalledTimes(1);
    expect(salesHandler.handle).not.toHaveBeenCalled();
  });

  it("routes message.received with targetAgentId: 'sales-closer' to only Sales Closer", async () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.register("org-1", {
      agentId: "lead-responder",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: {
        accepts: ["message.received"],
        emits: [],
        tools: [],
      },
    });
    agentRegistry.register("org-1", {
      agentId: "sales-closer",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: {
        accepts: ["message.received"],
        emits: [],
        tools: [],
      },
    });

    const handlerRegistry = new HandlerRegistry();
    const leadHandler = makeHandler(() => ({ events: [], actions: [] }));
    const salesHandler = makeHandler(() => ({ events: [], actions: [] }));
    handlerRegistry.register("lead-responder", leadHandler);
    handlerRegistry.register("sales-closer", salesHandler);

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
      eventType: "message.received",
      source: { type: "webhook", id: "whatsapp" },
      payload: { text: "hello" },
      metadata: { targetAgentId: "sales-closer" },
    });

    const result = await loop.process(event, { organizationId: "org-1" });

    expect(result.processed).toHaveLength(1);
    expect(result.processed[0]!.agentId).toBe("sales-closer");
    expect(salesHandler.handle).toHaveBeenCalledTimes(1);
    expect(leadHandler.handle).not.toHaveBeenCalled();
  });

  it("routes lead.received with NO targetAgentId to all matching agents", async () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.register("org-1", {
      agentId: "lead-responder",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: {
        accepts: ["lead.received"],
        emits: [],
        tools: [],
      },
    });
    agentRegistry.register("org-1", {
      agentId: "sales-closer",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: {
        accepts: ["lead.received"],
        emits: [],
        tools: [],
      },
    });

    const handlerRegistry = new HandlerRegistry();
    const leadHandler = makeHandler(() => ({ events: [], actions: [] }));
    const salesHandler = makeHandler(() => ({ events: [], actions: [] }));
    handlerRegistry.register("lead-responder", leadHandler);
    handlerRegistry.register("sales-closer", salesHandler);

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
      eventType: "lead.received",
      source: { type: "webhook", id: "telegram" },
      payload: { contactId: "c1" },
      // NO targetAgentId in metadata
    });

    const result = await loop.process(event, { organizationId: "org-1" });

    expect(result.processed).toHaveLength(2);
    expect(result.processed[0]!.agentId).toBe("lead-responder");
    expect(result.processed[1]!.agentId).toBe("sales-closer");
    expect(leadHandler.handle).toHaveBeenCalledTimes(1);
    expect(salesHandler.handle).toHaveBeenCalledTimes(1);
  });

  it("routes message.received with targetAgentId: 'nonexistent-agent' to manual_queue", async () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.register("org-1", {
      agentId: "lead-responder",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: {
        accepts: ["message.received"],
        emits: [],
        tools: [],
      },
    });
    agentRegistry.register("org-1", {
      agentId: "sales-closer",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: {
        accepts: ["message.received"],
        emits: [],
        tools: [],
      },
    });

    const handlerRegistry = new HandlerRegistry();
    const leadHandler = makeHandler(() => ({ events: [], actions: [] }));
    const salesHandler = makeHandler(() => ({ events: [], actions: [] }));
    handlerRegistry.register("lead-responder", leadHandler);
    handlerRegistry.register("sales-closer", salesHandler);

    const deliveryStore = new InMemoryDeliveryStore();
    const loop = new EventLoop({
      router: new AgentRouter(agentRegistry),
      registry: agentRegistry,
      handlers: handlerRegistry,
      actionExecutor: new ActionExecutor(),
      policyBridge: new PolicyBridge(null),
      deliveryStore,
    });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "message.received",
      source: { type: "webhook", id: "whatsapp" },
      payload: { text: "hello" },
      metadata: { targetAgentId: "nonexistent-agent" },
    });

    const result = await loop.process(event, { organizationId: "org-1" });

    expect(result.processed).toHaveLength(0);
    expect(leadHandler.handle).not.toHaveBeenCalled();
    expect(salesHandler.handle).not.toHaveBeenCalled();

    const deliveries = await deliveryStore.getByEvent(event.eventId);
    expect(deliveries.some((d) => d.destinationId === "manual_queue")).toBe(true);
  });

  it("routes message.received with targetAgentId to disabled agent to manual_queue", async () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.register("org-1", {
      agentId: "lead-responder",
      version: "0.1.0",
      installed: true,
      status: "disabled",
      config: {},
      capabilities: {
        accepts: ["message.received"],
        emits: [],
        tools: [],
      },
    });

    const handlerRegistry = new HandlerRegistry();
    const leadHandler = makeHandler(() => ({ events: [], actions: [] }));
    handlerRegistry.register("lead-responder", leadHandler);

    const deliveryStore = new InMemoryDeliveryStore();
    const loop = new EventLoop({
      router: new AgentRouter(agentRegistry),
      registry: agentRegistry,
      handlers: handlerRegistry,
      actionExecutor: new ActionExecutor(),
      policyBridge: new PolicyBridge(null),
      deliveryStore,
    });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "message.received",
      source: { type: "webhook", id: "whatsapp" },
      payload: { text: "hello" },
      metadata: { targetAgentId: "lead-responder" },
    });

    const result = await loop.process(event, { organizationId: "org-1" });

    expect(result.processed).toHaveLength(0);
    expect(leadHandler.handle).not.toHaveBeenCalled();

    const deliveries = await deliveryStore.getByEvent(event.eventId);
    expect(deliveries.some((d) => d.destinationId === "manual_queue")).toBe(true);
  });

  it("recursive output events from targeted handler do NOT inherit targetAgentId", async () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.register("org-1", {
      agentId: "lead-responder",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: {
        accepts: ["message.received"],
        emits: ["lead.qualified"],
        tools: [],
      },
    });
    agentRegistry.register("org-1", {
      agentId: "sales-closer",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: {
        accepts: ["lead.qualified"],
        emits: [],
        tools: [],
      },
    });

    const handlerRegistry = new HandlerRegistry();
    handlerRegistry.register(
      "lead-responder",
      makeHandler((event) => ({
        events: [
          createEventEnvelope({
            organizationId: event.organizationId,
            eventType: "lead.qualified",
            source: { type: "agent", id: "lead-responder" },
            payload: { contactId: "c1" },
            correlationId: event.correlationId,
            causationId: event.eventId,
            // Output event does NOT include targetAgentId in metadata
          }),
        ],
        actions: [],
      })),
    );
    const salesHandler = makeHandler(() => ({ events: [], actions: [] }));
    handlerRegistry.register("sales-closer", salesHandler);

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
      eventType: "message.received",
      source: { type: "webhook", id: "whatsapp" },
      payload: { text: "hello" },
      metadata: { targetAgentId: "lead-responder" },
    });

    const result = await loop.process(event, { organizationId: "org-1" });

    // Lead Responder processes the targeted message.received
    // Sales Closer processes the output lead.qualified (routes normally, no targeting)
    expect(result.processed).toHaveLength(2);
    expect(result.processed[0]!.agentId).toBe("lead-responder");
    expect(result.processed[0]!.outputEvents).toEqual(["lead.qualified"]);
    expect(result.processed[1]!.agentId).toBe("sales-closer");
    expect(salesHandler.handle).toHaveBeenCalledTimes(1);
  });
});
