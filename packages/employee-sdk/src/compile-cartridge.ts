import type { Cartridge, CartridgeManifest, CartridgeContext } from "@switchboard/schemas";
import type { EmployeeConfig, EmployeeContext } from "./types.js";

export function compileCartridge(
  config: EmployeeConfig,
  contextFactory: (cartridgeContext: CartridgeContext) => EmployeeContext,
): Cartridge {
  const manifest: CartridgeManifest = {
    id: config.id,
    name: config.name,
    version: config.version,
    description: config.description,
    actions: config.actions.map((a) => ({
      actionType: a.type,
      name: a.type.split(".").pop() ?? a.type,
      description: a.description,
      parametersSchema: {},
      baseRiskCategory: a.riskCategory,
      reversible: a.reversible,
    })),
    requiredConnections: (config.connections ?? []).filter((c) => c.required).map((c) => c.service),
    defaultPolicies: (config.policies ?? []).map((p) => `${p.action}:${p.effect}`),
  };

  return {
    manifest,

    async initialize() {
      // no-op — employee lifecycle managed by the SDK
    },

    async enrichContext(_actionType, parameters) {
      return parameters;
    },

    async execute(actionType, parameters, ctx) {
      const employeeCtx = contextFactory(ctx);
      return config.execute(actionType, parameters, employeeCtx);
    },

    async getRiskInput(actionType) {
      const actionDef = config.actions.find((a) => a.type === actionType);
      return {
        baseRisk: actionDef?.riskCategory ?? "medium",
        exposure: { dollarsAtRisk: 0, blastRadius: 0 },
        reversibility: actionDef?.reversible ? ("full" as const) : ("none" as const),
        sensitivity: {
          entityVolatile: false,
          learningPhase: false,
          recentlyModified: false,
        },
      };
    },

    getGuardrails() {
      return {
        rateLimits: (config.guardrails?.rateLimits ?? []).map((r) => ({
          scope: r.actionPattern,
          maxActions: r.maxPerHour,
          windowMs: 3_600_000,
        })),
        cooldowns: (config.guardrails?.cooldowns ?? []).map((c) => ({
          actionType: c.actionPattern,
          cooldownMs: c.seconds * 1000,
          scope: "organization",
        })),
        protectedEntities: [],
      };
    },

    async healthCheck() {
      return {
        status: "connected" as const,
        latencyMs: 0,
        error: null,
        capabilities: [],
      };
    },
  };
}
