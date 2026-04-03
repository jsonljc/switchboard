import { describe, it, expect, vi } from "vitest";
import { compileCartridge } from "../compile-cartridge.js";
import type { EmployeeConfig, EmployeeContext } from "../types.js";
import { z } from "zod";

const minimalConfig: EmployeeConfig = {
  id: "test-cart",
  name: "Test Cartridge",
  version: "1.0.0",
  description: "A test cartridge",
  personality: { role: "Test", tone: "neutral", traits: [] },
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

describe("compileCartridge", () => {
  it("creates a manifest with correct action shapes", () => {
    const mockCtxFactory = vi.fn();
    const cartridge = compileCartridge(minimalConfig, mockCtxFactory);

    expect(cartridge.manifest.id).toBe("test-cart");
    expect(cartridge.manifest.actions).toHaveLength(1);

    const action = cartridge.manifest.actions[0]!;
    expect(action.actionType).toBe("test.do_thing");
    expect(action.baseRiskCategory).toBe("low");
    expect(action.reversible).toBe(true);
  });

  it("delegates execute to config.execute with EmployeeContext", async () => {
    const mockExecute = vi.fn().mockResolvedValue({
      success: true,
      summary: "done",
      externalRefs: {},
      rollbackAvailable: false,
      partialFailures: [],
      durationMs: 50,
      undoRecipe: null,
    });
    const config = { ...minimalConfig, execute: mockExecute };
    const mockCtx = { organizationId: "org-1" } as EmployeeContext;
    const mockCtxFactory = vi.fn().mockReturnValue(mockCtx);

    const cartridge = compileCartridge(config, mockCtxFactory);
    const result = await cartridge.execute(
      "test.do_thing",
      { input: "hello" },
      { principalId: "user-1", organizationId: "org-1", connectionCredentials: {} },
    );

    expect(result.success).toBe(true);
    expect(mockCtxFactory).toHaveBeenCalled();
    expect(mockExecute).toHaveBeenCalledWith("test.do_thing", { input: "hello" }, mockCtx);
  });

  it("returns correct risk input", async () => {
    const mockCtxFactory = vi.fn();
    const cartridge = compileCartridge(minimalConfig, mockCtxFactory);

    const risk = await cartridge.getRiskInput("test.do_thing", {}, {});
    expect(risk.baseRisk).toBe("low");
    expect(risk.reversibility).toBe("full");
    expect(risk.exposure).toEqual({ dollarsAtRisk: 0, blastRadius: 0 });
  });

  it("returns connected health check", async () => {
    const mockCtxFactory = vi.fn();
    const cartridge = compileCartridge(minimalConfig, mockCtxFactory);

    const health = await cartridge.healthCheck();
    expect(health.status).toBe("connected");
  });
});
