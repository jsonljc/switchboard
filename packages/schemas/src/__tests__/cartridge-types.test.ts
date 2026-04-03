import { describe, it, expect } from "vitest";
import type {
  Cartridge,
  CartridgeContext,
  ExecuteResult,
  ConnectionContract,
  CartridgeInterceptor,
} from "../cartridge-types.js";
import type { CartridgeManifest, ConnectionHealth, GuardrailConfig } from "../cartridge.js";
import type { RiskInput } from "../risk.js";

describe("Cartridge types", () => {
  it("ExecuteResult is structurally valid", () => {
    const result: ExecuteResult = {
      success: true,
      summary: "done",
      externalRefs: {},
      rollbackAvailable: false,
      partialFailures: [],
      durationMs: 100,
      undoRecipe: null,
    };
    expect(result.success).toBe(true);
  });

  it("ExecuteResult accepts optional data field", () => {
    const result: ExecuteResult = {
      success: true,
      summary: "ok",
      externalRefs: {},
      rollbackAvailable: false,
      partialFailures: [],
      durationMs: 0,
      undoRecipe: null,
      data: { diagnostics: [1, 2, 3] },
    };
    expect(result.data).toEqual({ diagnostics: [1, 2, 3] });
  });

  it("ExecuteResult accepts partial failures", () => {
    const result: ExecuteResult = {
      success: false,
      summary: "Partially failed",
      externalRefs: {},
      rollbackAvailable: true,
      partialFailures: [{ step: "step1", error: "timeout" }],
      durationMs: 100,
      undoRecipe: null,
    };
    expect(result.partialFailures).toHaveLength(1);
    expect(result.partialFailures[0]!.step).toBe("step1");
  });

  it("CartridgeContext is structurally valid", () => {
    const ctx: CartridgeContext = {
      principalId: "user-1",
      organizationId: "org-1",
      connectionCredentials: {},
    };
    expect(ctx.principalId).toBe("user-1");
  });

  it("CartridgeContext accepts null organizationId", () => {
    const ctx: CartridgeContext = {
      principalId: "user-2",
      organizationId: null,
      connectionCredentials: {},
    };
    expect(ctx.organizationId).toBeNull();
  });

  it("ConnectionContract is structurally valid", () => {
    const conn: ConnectionContract = {
      serviceId: "openai",
      serviceName: "OpenAI",
      authType: "api_key",
      requiredScopes: [],
      refreshStrategy: "none",
      healthCheck: async () => ({
        status: "connected" as const,
        latencyMs: 10,
        error: null,
        capabilities: [],
      }),
    };
    expect(conn.serviceId).toBe("openai");
  });

  it("ConnectionContract accepts all authType values", () => {
    const authTypes: ConnectionContract["authType"][] = ["oauth2", "api_key", "service_account"];
    expect(authTypes).toHaveLength(3);
  });

  it("ConnectionContract accepts all refreshStrategy values", () => {
    const strategies: ConnectionContract["refreshStrategy"][] = ["auto", "manual", "none"];
    expect(strategies).toHaveLength(3);
  });

  it("Cartridge interface can be structurally typed", () => {
    const manifest: CartridgeManifest = {
      id: "test",
      name: "Test",
      description: "Test cartridge",
      version: "1.0.0",
      actions: [],
      requiredConnections: [],
      defaultPolicies: [],
    };

    const riskInput: RiskInput = {
      baseRisk: "low",
      exposure: { dollarsAtRisk: 0, blastRadius: 0 },
      reversibility: "full",
      sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
    };

    const guardrails: GuardrailConfig = {
      rateLimits: [],
      cooldowns: [],
      protectedEntities: [],
    };

    const health: ConnectionHealth = {
      status: "connected",
      latencyMs: 5,
      error: null,
      capabilities: [],
    };

    const cartridge: Cartridge = {
      manifest,
      initialize: async () => {},
      enrichContext: async () => ({}),
      execute: async () => ({
        success: true,
        summary: "ok",
        externalRefs: {},
        rollbackAvailable: false,
        partialFailures: [],
        durationMs: 0,
        undoRecipe: null,
      }),
      getRiskInput: async () => riskInput,
      getGuardrails: () => guardrails,
      healthCheck: async () => health,
    };

    expect(cartridge.manifest.id).toBe("test");
    expect(cartridge.resolveEntity).toBeUndefined();
    expect(cartridge.captureSnapshot).toBeUndefined();
  });

  it("CartridgeInterceptor is structurally valid with no hooks", () => {
    const interceptor: CartridgeInterceptor = {};
    expect(interceptor.beforeEnrich).toBeUndefined();
    expect(interceptor.beforeExecute).toBeUndefined();
    expect(interceptor.afterExecute).toBeUndefined();
  });

  it("CartridgeInterceptor accepts all hooks", () => {
    const interceptor: CartridgeInterceptor = {
      beforeEnrich: async (_actionType, parameters) => ({ parameters }),
      beforeExecute: async () => ({ proceed: true, parameters: {} }),
      afterExecute: async (_actionType, _params, result) => result,
    };
    expect(interceptor.beforeEnrich).toBeDefined();
    expect(interceptor.beforeExecute).toBeDefined();
    expect(interceptor.afterExecute).toBeDefined();
  });
});
