import { describe, it, expect } from "vitest";
import { defineEmployee } from "../define-employee.js";
import { z } from "zod";
import type { EmployeeConfig } from "../types.js";

const minimalConfig: EmployeeConfig = {
  id: "test-employee",
  name: "Test Employee",
  version: "1.0.0",
  description: "A test employee",
  personality: { role: "You are a test.", tone: "neutral", traits: ["helpful"] },
  inboundEvents: ["test.requested"],
  outboundEvents: ["test.done"],
  actions: [
    {
      type: "test.do_thing",
      description: "Do a thing",
      riskCategory: "low",
      reversible: true,
      parameters: z.object({ input: z.string() }),
    },
  ],
  handle: async () => ({ actions: [], events: [] }),
  execute: async () => ({
    success: true,
    summary: "done",
    externalRefs: {},
    rollbackAvailable: false,
    partialFailures: [],
    durationMs: 0,
    undoRecipe: null,
  }),
};

describe("defineEmployee", () => {
  it("returns a CompiledEmployee with port, handler, cartridge, defaults", () => {
    const compiled = defineEmployee(minimalConfig);
    expect(compiled.port.agentId).toBe("test-employee");
    expect(compiled.port.inboundEvents).toEqual(["test.requested"]);
    expect(compiled.port.outboundEvents).toEqual(["test.done"]);
    expect(compiled.cartridge.manifest.id).toBe("test-employee");
    expect(compiled.cartridge.manifest.actions).toHaveLength(1);
    expect(compiled.defaults.policies).toEqual([]);
    expect(compiled.connections).toEqual([]);
  });

  it("validates required fields", () => {
    expect(() => defineEmployee({ ...minimalConfig, id: "" })).toThrow("Employee id is required");
    expect(() => defineEmployee({ ...minimalConfig, actions: [] })).toThrow(
      "At least one action is required",
    );
    expect(() => defineEmployee({ ...minimalConfig, inboundEvents: [] })).toThrow(
      "At least one inbound event is required",
    );
  });

  it("compiles policies and guardrails from config", () => {
    const compiled = defineEmployee({
      ...minimalConfig,
      policies: [{ action: "test.do_thing", effect: "require_approval" }],
      guardrails: { rateLimits: [{ actionPattern: "test.do_thing", maxPerHour: 5 }] },
    });
    expect(compiled.defaults.policies).toHaveLength(1);
    expect(compiled.defaults.guardrails.rateLimits).toHaveLength(1);
  });

  it("compiles connections from config", () => {
    const compiled = defineEmployee({
      ...minimalConfig,
      connections: [{ service: "openai", purpose: "Content generation", required: true }],
    });
    expect(compiled.connections).toHaveLength(1);
    expect(compiled.cartridge.manifest.requiredConnections).toEqual(["openai"]);
  });

  it("cartridge manifest has correct action shape", () => {
    const compiled = defineEmployee(minimalConfig);
    const action = compiled.cartridge.manifest.actions[0]!;
    expect(action.actionType).toBe("test.do_thing");
    expect(action.baseRiskCategory).toBe("low");
    expect(action.reversible).toBe(true);
  });
});
