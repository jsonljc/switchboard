import { describe, it, expect } from "vitest";
import type { Cartridge, CartridgeContext, ExecuteResult } from "@switchboard/cartridge-sdk";
import { GuardedCartridge, beginExecution, endExecution } from "../execution-guard.js";

const ctx: CartridgeContext = {
  principalId: "p1",
  organizationId: null,
  connectionCredentials: {},
};

/** Minimal mock cartridge for testing the guard. */
function createMockCartridge(): Cartridge {
  return {
    manifest: {
      id: "test-cartridge",
      name: "Test",
      version: "1.0.0",
      description: "Mock cartridge for execution guard tests",
      actions: [],
      requiredConnections: [],
      defaultPolicies: [],
    },
    initialize: async () => {},
    enrichContext: async (_at: string, _p: Record<string, unknown>, _c: CartridgeContext) => ({}),
    execute: async (
      _at: string,
      _p: Record<string, unknown>,
      _c: CartridgeContext,
    ): Promise<ExecuteResult> => ({
      success: true,
      summary: "Mock executed",
      externalRefs: {},
      rollbackAvailable: false,
      partialFailures: [],
      durationMs: 1,
      undoRecipe: null,
    }),
    getRiskInput: async () => ({
      baseRisk: "low" as const,
      exposure: { dollarsAtRisk: 0, blastRadius: 0 },
      reversibility: "full" as const,
      sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
    }),
    getGuardrails: () => ({
      rateLimits: [],
      cooldowns: [],
      protectedEntities: [],
    }),
    healthCheck: async () => ({
      status: "connected" as const,
      error: null,
      latencyMs: 1,
      capabilities: [],
    }),
  };
}

describe("GuardedCartridge", () => {
  it("blocks execute() when no token is bound", async () => {
    const guarded = new GuardedCartridge(createMockCartridge());

    await expect(guarded.execute("test.action", {}, ctx)).rejects.toThrow(
      "Cartridge.execute() called outside of orchestrator executeApproved()",
    );
  });

  it("blocks execute() when token is not in active set", async () => {
    const guarded = new GuardedCartridge(createMockCartridge());
    const token = beginExecution();
    guarded.bindToken(token);
    // End the execution (remove token from active set) but keep it bound
    endExecution(token);

    await expect(guarded.execute("test.action", {}, ctx)).rejects.toThrow(
      "Direct execution is forbidden",
    );
  });

  it("allows execute() when a valid token is bound and active", async () => {
    const guarded = new GuardedCartridge(createMockCartridge());
    const token = beginExecution();
    guarded.bindToken(token);

    const result = await guarded.execute("test.action", {}, ctx);

    expect(result.success).toBe(true);
    expect(result.summary).toBe("Mock executed");

    endExecution(token);
    guarded.unbindToken();
  });

  it("blocks execute() after unbindToken() is called", async () => {
    const guarded = new GuardedCartridge(createMockCartridge());
    const token = beginExecution();
    guarded.bindToken(token);

    // First call succeeds
    const result = await guarded.execute("test.action", {}, ctx);
    expect(result.success).toBe(true);

    // Unbind and try again
    guarded.unbindToken();
    await expect(guarded.execute("test.action", {}, ctx)).rejects.toThrow(
      "Direct execution is forbidden",
    );

    endExecution(token);
  });

  it("delegates manifest, enrichContext, getRiskInput, getGuardrails, healthCheck without token", async () => {
    const inner = createMockCartridge();
    const guarded = new GuardedCartridge(inner);

    // These should all work without any token
    expect(guarded.manifest.id).toBe("test-cartridge");
    const enriched = await guarded.enrichContext("test", {}, ctx);
    expect(enriched).toEqual({});
    const risk = await guarded.getRiskInput("test", {}, {});
    expect(risk.baseRisk).toBe("low");
    const guardrails = guarded.getGuardrails();
    expect(guardrails.rateLimits).toEqual([]);
    const health = await guarded.healthCheck();
    expect(health.status).toBe("connected");
  });

  it("runs beforeExecute interceptor and blocks when it returns proceed=false", async () => {
    const guarded = new GuardedCartridge(createMockCartridge(), [
      {
        beforeExecute: async (_actionType, params, _ctx) => ({
          proceed: false,
          reason: "Blocked by test interceptor",
          parameters: params,
        }),
      },
    ]);

    const token = beginExecution();
    guarded.bindToken(token);

    const result = await guarded.execute("test.action", {}, ctx);

    expect(result.success).toBe(false);
    expect(result.summary).toContain("Blocked by test interceptor");

    endExecution(token);
    guarded.unbindToken();
  });
});
