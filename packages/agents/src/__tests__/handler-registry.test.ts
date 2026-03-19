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

    registry.register("lead-responder", handler);

    expect(registry.get("lead-responder")).toBe(handler);
  });

  it("returns undefined for unregistered agent", () => {
    const registry = new HandlerRegistry();
    expect(registry.get("unknown-agent")).toBeUndefined();
  });

  it("reports whether an agent is registered", () => {
    const registry = new HandlerRegistry();
    const handler = makeMockHandler();

    registry.register("lead-responder", handler);

    expect(registry.has("lead-responder")).toBe(true);
    expect(registry.has("unknown")).toBe(false);
  });

  it("lists all registered agent ids", () => {
    const registry = new HandlerRegistry();
    registry.register("lead-responder", makeMockHandler());
    registry.register("sales-closer", makeMockHandler());

    expect(registry.listRegistered().sort()).toEqual(["lead-responder", "sales-closer"]);
  });

  it("overwrites handler on re-register", () => {
    const registry = new HandlerRegistry();
    const first = makeMockHandler();
    const second = makeMockHandler();

    registry.register("lead-responder", first);
    registry.register("lead-responder", second);

    expect(registry.get("lead-responder")).toBe(second);
  });
});
