import { describe, it, expect, vi } from "vitest";
import { HandlerRegistry } from "../handler-registry.js";
import type { AgentHandler } from "../ports.js";

function makeMockHandler(): AgentHandler {
  return {
    handle: vi.fn().mockResolvedValue({ events: [], actions: [] }),
  };
}

describe("HandlerRegistry", () => {
  it("registers and retrieves a handler", () => {
    const registry = new HandlerRegistry();
    const handler = makeMockHandler();

    registry.register("employee-a", handler);

    expect(registry.get("employee-a")).toBe(handler);
  });

  it("returns undefined for unregistered agent", () => {
    const registry = new HandlerRegistry();
    expect(registry.get("unknown-agent")).toBeUndefined();
  });

  it("reports whether an agent is registered", () => {
    const registry = new HandlerRegistry();
    const handler = makeMockHandler();

    registry.register("employee-a", handler);

    expect(registry.has("employee-a")).toBe(true);
    expect(registry.has("unknown")).toBe(false);
  });

  it("lists all registered agent ids", () => {
    const registry = new HandlerRegistry();
    registry.register("employee-a", makeMockHandler());
    registry.register("employee-b", makeMockHandler());

    expect(registry.listRegistered().sort()).toEqual(["employee-a", "employee-b"]);
  });

  it("overwrites handler on re-register", () => {
    const registry = new HandlerRegistry();
    const first = makeMockHandler();
    const second = makeMockHandler();

    registry.register("employee-a", first);
    registry.register("employee-a", second);

    expect(registry.get("employee-a")).toBe(second);
  });

  it("removes a registered handler", () => {
    const registry = new HandlerRegistry();
    const handler = makeMockHandler();

    registry.register("employee-a", handler);
    expect(registry.has("employee-a")).toBe(true);

    const removed = registry.remove("employee-a");
    expect(removed).toBe(true);
    expect(registry.has("employee-a")).toBe(false);
    expect(registry.get("employee-a")).toBeUndefined();
  });
});
