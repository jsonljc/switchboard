/* eslint-disable max-lines */
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

function setupRegistry(): AgentRegistry {
  const registry = new AgentRegistry();
  registry.register("org-1", {
    agentId: "employee-a",
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
    agentId: "employee-b",
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
  it("chains lead.received → employee-a → lead.qualified → employee-b", async () => {
    const agentRegistry = setupRegistry();
    const handlerRegistry = new HandlerRegistry();

    handlerRegistry.register(
      "employee-a",
      makeHandler((event) => ({
        events: [
          createEventEnvelope({
            organizationId: event.organizationId,
            eventType: "lead.qualified",
            source: { type: "agent", id: "employee-a" },
            payload: { contactId: "c1", score: 80 },
            correlationId: event.correlationId,
            causationId: event.eventId,
          }),
        ],
        actions: [],
      })),
    );

    handlerRegistry.register(
      "employee-b",
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
    expect(result.processed[0]!.agentId).toBe("employee-a");
    expect(result.processed[0]!.outputEvents).toEqual(["lead.qualified"]);
    expect(result.processed[1]!.agentId).toBe("employee-b");
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

  it("skips hybrid agents for top-level non-urgent events", async () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.register("org-1", {
      agentId: "employee-c",
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
    handlerRegistry.register("employee-c", handler);

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
      source: { type: "agent", id: "employee-d" },
      payload: {},
    });

    const result = await loop.process(event, { organizationId: "org-1" });

    expect(result.processed).toHaveLength(0);
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it("processes hybrid agents for chained events (depth > 0)", async () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.register("org-1", {
      agentId: "employee-d",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: {
        accepts: ["revenue.recorded"],
        emits: ["revenue.attributed"],
        tools: [],
      },
    });
    agentRegistry.register("org-1", {
      agentId: "employee-c",
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
    handlerRegistry.register(
      "employee-d",
      makeHandler((event) => ({
        events: [
          createEventEnvelope({
            organizationId: event.organizationId,
            eventType: "revenue.attributed",
            source: { type: "agent", id: "employee-d" },
            payload: { campaignId: "camp-1", amount: 100 },
            correlationId: event.correlationId,
            causationId: event.eventId,
          }),
        ],
        actions: [],
      })),
    );

    const adOptHandler = makeHandler(() => ({ events: [], actions: [] }));
    handlerRegistry.register("employee-c", adOptHandler);

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
      eventType: "revenue.recorded",
      source: { type: "system", id: "payments" },
      payload: { contactId: "c1", amount: 100 },
    });

    const result = await loop.process(event, { organizationId: "org-1" });

    expect(result.processed).toHaveLength(2);
    expect(result.processed[0]!.agentId).toBe("employee-d");
    expect(result.processed[1]!.agentId).toBe("employee-c");
    expect(adOptHandler.handle).toHaveBeenCalledTimes(1);
    expect(result.depth).toBe(1);
  });

  it("tracks failed actions separately from successful ones", async () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.register("org-1", {
      agentId: "test-agent",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: { accepts: ["test.event"], emits: [], tools: [] },
    });

    const handlerRegistry = new HandlerRegistry();
    handlerRegistry.register(
      "test-agent",
      makeHandler(() => ({
        events: [],
        actions: [
          { actionType: "action.good", parameters: {} },
          { actionType: "action.bad", parameters: {} },
        ],
      })),
    );

    const actionExecutor = new ActionExecutor();
    actionExecutor.register("action.good", vi.fn().mockResolvedValue({ success: true }));
    actionExecutor.register("action.bad", vi.fn().mockResolvedValue({ success: false }));

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
      eventType: "test.event",
      source: { type: "system", id: "test" },
      payload: {},
    });

    const result = await loop.process(event, { organizationId: "org-1" });

    expect(result.processed[0]!.actionsExecuted).toEqual(["action.good"]);
    expect(result.processed[0]!.actionsFailed).toEqual(["action.bad"]);
  });

  it("routes urgent events to hybrid agents", async () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.register("org-1", {
      agentId: "employee-c",
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
    handlerRegistry.register("employee-c", handler);

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
      source: { type: "agent", id: "employee-d" },
      payload: { reason: "spend_spike" },
    });

    const result = await loop.process(event, { organizationId: "org-1" });

    expect(result.processed).toHaveLength(1);
    expect(result.processed[0]!.agentId).toBe("employee-c");
  });

  it("updates state tracker during processing", async () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.register("org-1", {
      agentId: "employee-a",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: { accepts: ["lead.received"], emits: [], tools: [] },
    });

    const handlerRegistry = new HandlerRegistry();
    handlerRegistry.register(
      "employee-a",
      makeHandler(() => ({ events: [], actions: [] })),
    );

    const stateTracker = {
      startProcessing: vi.fn(),
      completeProcessing: vi.fn(),
      setError: vi.fn(),
    };

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

    expect(stateTracker.startProcessing).toHaveBeenCalledWith(
      "org-1",
      "employee-a",
      expect.any(String),
    );
    expect(stateTracker.completeProcessing).toHaveBeenCalledWith(
      "org-1",
      "employee-a",
      expect.any(String),
    );
  });

  it("deduplicates events by idempotencyKey", async () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.register("org-1", {
      agentId: "test-agent",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: { accepts: ["test.event"], emits: ["test.event"], tools: [] },
    });

    const handlerRegistry = new HandlerRegistry();
    const handler = makeHandler((event) => ({
      events: [
        createEventEnvelope({
          organizationId: event.organizationId,
          eventType: "test.event",
          source: { type: "agent", id: "test-agent" },
          payload: {},
          correlationId: event.correlationId,
          idempotencyKey: "same-key",
        }),
      ],
      actions: [],
    }));
    handlerRegistry.register("test-agent", handler);

    const loop = new EventLoop({
      router: new AgentRouter(agentRegistry),
      registry: agentRegistry,
      handlers: handlerRegistry,
      actionExecutor: new ActionExecutor(),
      policyBridge: new PolicyBridge(null),
      deliveryStore: new InMemoryDeliveryStore(),
      maxDepth: 5,
    });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "test.event",
      source: { type: "system", id: "test" },
      payload: {},
    });

    const result = await loop.process(event, { organizationId: "org-1" });

    // Initial event processes (unique key), output event processes (key "same-key"),
    // but output's chained event with same key "same-key" gets deduped — only 2 not 5
    expect(result.processed).toHaveLength(2);
  });

  it("continues processing when deliveryStore.record() throws", async () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.register("org-1", {
      agentId: "test-agent",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: { accepts: ["test.event"], emits: [], tools: [] },
    });

    const handlerRegistry = new HandlerRegistry();
    handlerRegistry.register(
      "test-agent",
      makeHandler(() => ({ events: [], actions: [] })),
    );

    const brokenStore = new InMemoryDeliveryStore();
    brokenStore.record = vi.fn().mockRejectedValue(new Error("store down"));

    const loop = new EventLoop({
      router: new AgentRouter(agentRegistry),
      registry: agentRegistry,
      handlers: handlerRegistry,
      actionExecutor: new ActionExecutor(),
      policyBridge: new PolicyBridge(null),
      deliveryStore: brokenStore,
    });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "test.event",
      source: { type: "system", id: "test" },
      payload: {},
    });

    // Should not throw despite store failure
    const result = await loop.process(event, { organizationId: "org-1" });
    expect(result.processed).toHaveLength(1);
    expect(result.processed[0]!.success).toBe(true);
  });

  it("checks for matching triggers when processing events", async () => {
    const agentRegistry = new AgentRegistry();
    const handlerRegistry = new HandlerRegistry();

    const mockScheduler = {
      matchEvent: vi.fn(async () => []),
      registerTrigger: vi.fn(),
      cancelTrigger: vi.fn(),
      listPendingTriggers: vi.fn(),
    };

    const loop = new EventLoop({
      router: new AgentRouter(agentRegistry),
      registry: agentRegistry,
      handlers: handlerRegistry,
      actionExecutor: new ActionExecutor(),
      policyBridge: new PolicyBridge(null),
      deliveryStore: new InMemoryDeliveryStore(),
      scheduler: mockScheduler,
    });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "payment.received",
      source: { type: "webhook", id: "stripe" },
      payload: { amount: 100 },
    });

    await loop.process(event, { organizationId: "org-1" });

    expect(mockScheduler.matchEvent).toHaveBeenCalledWith(
      "org-1",
      "payment.received",
      expect.objectContaining({ amount: 100 }),
    );
  });

  it("fires matched triggers by invoking onTriggerFired callback", async () => {
    const agentRegistry = new AgentRegistry();
    const handlerRegistry = new HandlerRegistry();

    const mockTrigger = {
      id: "trig-1",
      organizationId: "org-1",
      type: "event_match" as const,
      action: { type: "resume_workflow" as const, payload: { workflowId: "wf-1" } },
      status: "active" as const,
      eventPattern: { type: "payment.received", filters: {} },
      fireAt: null,
      cronExpression: null,
      sourceWorkflowId: "wf-1",
      createdAt: new Date(),
      expiresAt: null,
    };

    const mockScheduler = {
      matchEvent: vi.fn(async () => [mockTrigger]),
      registerTrigger: vi.fn(),
      cancelTrigger: vi.fn(),
      listPendingTriggers: vi.fn(),
    };

    const onTriggerFired = vi.fn();

    const loop = new EventLoop({
      router: new AgentRouter(agentRegistry),
      registry: agentRegistry,
      handlers: handlerRegistry,
      actionExecutor: new ActionExecutor(),
      policyBridge: new PolicyBridge(null),
      deliveryStore: new InMemoryDeliveryStore(),
      scheduler: mockScheduler,
      onTriggerFired,
    });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "payment.received",
      source: { type: "webhook", id: "stripe" },
      payload: { amount: 100 },
    });

    await loop.process(event, { organizationId: "org-1" });

    expect(onTriggerFired).toHaveBeenCalledWith(mockTrigger);
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

    const stateTracker = {
      startProcessing: vi.fn(),
      completeProcessing: vi.fn(),
      setError: vi.fn(),
    };

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

    expect(stateTracker.setError).toHaveBeenCalledWith("org-1", "broken-agent", "handler crashed");
  });

  it("setScheduler wires scheduler after construction", async () => {
    const agentRegistry = new AgentRegistry();
    const handlerRegistry = new HandlerRegistry();

    const mockTrigger = {
      id: "trig-late",
      organizationId: "org-1",
      type: "event_match" as const,
      action: { type: "emit_event" as const, payload: {} },
      status: "active" as const,
      eventPattern: { type: "order.placed", filters: {} },
      fireAt: null,
      cronExpression: null,
      sourceWorkflowId: null,
      createdAt: new Date(),
      expiresAt: null,
    };

    const mockScheduler = {
      matchEvent: vi.fn(async () => [mockTrigger]),
      registerTrigger: vi.fn(),
      cancelTrigger: vi.fn(),
      listPendingTriggers: vi.fn(),
    };

    const onTriggerFired = vi.fn();

    // Create loop WITHOUT scheduler
    const loop = new EventLoop({
      router: new AgentRouter(agentRegistry),
      registry: agentRegistry,
      handlers: handlerRegistry,
      actionExecutor: new ActionExecutor(),
      policyBridge: new PolicyBridge(null),
      deliveryStore: new InMemoryDeliveryStore(),
    });

    // Wire scheduler after construction
    loop.setScheduler(mockScheduler, onTriggerFired);

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "order.placed",
      source: { type: "system", id: "test" },
      payload: { orderId: "ord-1" },
    });

    await loop.process(event, { organizationId: "org-1" });

    expect(mockScheduler.matchEvent).toHaveBeenCalledWith(
      "org-1",
      "order.placed",
      expect.objectContaining({ orderId: "ord-1" }),
    );
    expect(onTriggerFired).toHaveBeenCalledWith(mockTrigger);
  });
});
