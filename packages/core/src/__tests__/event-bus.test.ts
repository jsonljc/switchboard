import { describe, it, expect, vi } from "vitest";
import { InMemoryEventBus } from "../event-bus/bus.js";
import { resolveTemplate } from "../event-bus/template.js";
import type { DomainEvent } from "../event-bus/types.js";

describe("InMemoryEventBus", () => {
  it("publishes events to matching subscribers", async () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn().mockResolvedValue(undefined);
    bus.subscribe("payments.*", handler);

    const event: DomainEvent = {
      id: "evt_1",
      eventType: "payments.invoice.created",
      sourceCartridgeId: "payments",
      organizationId: "org_1",
      principalId: "user_1",
      payload: { invoiceId: "inv_1" },
      envelopeId: "env_1",
      traceId: "trace_1",
      emittedAt: new Date(),
    };

    await bus.publish(event);
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("does not publish to non-matching subscribers", async () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn().mockResolvedValue(undefined);
    bus.subscribe("crm.*", handler);

    await bus.publish({
      id: "evt_1",
      eventType: "payments.invoice.created",
      sourceCartridgeId: "payments",
      organizationId: "org_1",
      principalId: "user_1",
      payload: {},
      envelopeId: "env_1",
      traceId: "trace_1",
      emittedAt: new Date(),
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("unsubscribe removes handler", async () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn().mockResolvedValue(undefined);
    const unsub = bus.subscribe("*", handler);

    unsub();

    await bus.publish({
      id: "evt_1",
      eventType: "test.event",
      sourceCartridgeId: "test",
      organizationId: "org_1",
      principalId: "user_1",
      payload: {},
      envelopeId: "env_1",
      traceId: "trace_1",
      emittedAt: new Date(),
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("listSubscriptions returns active subscriptions", () => {
    const bus = new InMemoryEventBus();
    bus.subscribe("payments.*", async () => {});
    bus.subscribe("crm.*", async () => {});

    const subs = bus.listSubscriptions();
    expect(subs).toHaveLength(2);
    expect(subs.map((s) => s.pattern)).toContain("payments.*");
    expect(subs.map((s) => s.pattern)).toContain("crm.*");
  });

  it("exact pattern matching works", async () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn().mockResolvedValue(undefined);
    bus.subscribe("payments.invoice.created", handler);

    await bus.publish({
      id: "evt_1",
      eventType: "payments.invoice.created",
      sourceCartridgeId: "payments",
      organizationId: "org_1",
      principalId: "user_1",
      payload: {},
      envelopeId: "env_1",
      traceId: "trace_1",
      emittedAt: new Date(),
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("resolveTemplate", () => {
  it("resolves $event.payload paths", () => {
    const template = {
      entityId: "$event.payload.customerId",
      description: "From payment",
    };
    const event = {
      payload: { customerId: "cus_123", amount: 500 },
    };
    const result = resolveTemplate(template, event);
    expect(result.entityId).toBe("cus_123");
    expect(result.description).toBe("From payment");
  });

  it("resolves top-level $event fields", () => {
    const template = { actor: "$event.principalId" };
    const event = { principalId: "user_1", payload: {} };
    const result = resolveTemplate(template, event);
    expect(result.actor).toBe("user_1");
  });

  it("resolves nested paths", () => {
    const template = { value: "$event.payload.nested.deep.field" };
    const event = { payload: { nested: { deep: { field: 42 } } } };
    const result = resolveTemplate(template, event);
    expect(result.value).toBe(42);
  });

  it("handles missing paths gracefully", () => {
    const template = { value: "$event.payload.missing" };
    const event = { payload: {} };
    const result = resolveTemplate(template, event);
    expect(result.value).toBeUndefined();
  });

  it("passes through non-template values", () => {
    const template = { static: "hello", num: 42, flag: true };
    const result = resolveTemplate(template, {});
    expect(result).toEqual({ static: "hello", num: 42, flag: true });
  });

  it("resolves string interpolation", () => {
    const template = { msg: "Treatment: $event.payload.type at $event.payload.location" };
    const event = { payload: { type: "dental_crown", location: "clinic_a" } };
    const result = resolveTemplate(template, event);
    expect(result.msg).toBe("Treatment: dental_crown at clinic_a");
  });

  it("resolves arrays with template values", () => {
    const template = { ids: ["$event.payload.id1", "$event.payload.id2"] };
    const event = { payload: { id1: "a", id2: "b" } };
    const result = resolveTemplate(template, event);
    expect(result.ids).toEqual(["a", "b"]);
  });

  it("resolves nested objects", () => {
    const template = { inner: { id: "$event.payload.id" } };
    const event = { payload: { id: "x" } };
    const result = resolveTemplate(template, event);
    expect(result.inner).toEqual({ id: "x" });
  });
});
