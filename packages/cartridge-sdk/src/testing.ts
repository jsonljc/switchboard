import type { CartridgeManifest, ConnectionHealth, GuardrailConfig, RiskInput } from "@switchboard/schemas";
import type { Cartridge, CartridgeContext, ExecuteResult } from "./cartridge.js";

export class TestCartridge implements Cartridge {
  readonly manifest: CartridgeManifest;
  private executeHandler: ((actionType: string, params: Record<string, unknown>) => ExecuteResult) | null = null;
  private enrichHandler: ((actionType: string, params: Record<string, unknown>) => Record<string, unknown>) | null = null;
  private riskInputHandler: ((actionType: string, params: Record<string, unknown>) => RiskInput) | null = null;
  private guardrailConfig: GuardrailConfig = { rateLimits: [], cooldowns: [], protectedEntities: [] };

  constructor(manifest: CartridgeManifest) {
    this.manifest = manifest;
  }

  onExecute(handler: (actionType: string, params: Record<string, unknown>) => ExecuteResult): this {
    this.executeHandler = handler;
    return this;
  }

  onEnrich(handler: (actionType: string, params: Record<string, unknown>) => Record<string, unknown>): this {
    this.enrichHandler = handler;
    return this;
  }

  onRiskInput(handler: (actionType: string, params: Record<string, unknown>) => RiskInput): this {
    this.riskInputHandler = handler;
    return this;
  }

  onGuardrails(config: GuardrailConfig): this {
    this.guardrailConfig = config;
    return this;
  }

  async initialize(_context: CartridgeContext): Promise<void> {}

  async enrichContext(
    actionType: string,
    parameters: Record<string, unknown>,
    _context: CartridgeContext,
  ): Promise<Record<string, unknown>> {
    return this.enrichHandler?.(actionType, parameters) ?? {};
  }

  async execute(
    actionType: string,
    parameters: Record<string, unknown>,
    _context: CartridgeContext,
  ): Promise<ExecuteResult> {
    if (this.executeHandler) {
      return this.executeHandler(actionType, parameters);
    }
    return {
      success: true,
      summary: `Executed ${actionType}`,
      externalRefs: {},
      rollbackAvailable: false,
      partialFailures: [],
      durationMs: 10,
      undoRecipe: null,
    };
  }

  async getRiskInput(
    actionType: string,
    parameters: Record<string, unknown>,
    _context: Record<string, unknown>,
  ): Promise<RiskInput> {
    if (this.riskInputHandler) {
      return this.riskInputHandler(actionType, parameters);
    }
    return {
      baseRisk: "low",
      exposure: { dollarsAtRisk: 0, blastRadius: 1 },
      reversibility: "full",
      sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
    };
  }

  getGuardrails(): GuardrailConfig {
    return this.guardrailConfig;
  }

  async healthCheck(): Promise<ConnectionHealth> {
    return { status: "connected", latencyMs: 1, error: null, capabilities: [] };
  }
}

export function createTestManifest(overrides: Partial<CartridgeManifest> = {}): CartridgeManifest {
  return {
    id: overrides.id ?? "test-cartridge",
    name: overrides.name ?? "Test Cartridge",
    version: overrides.version ?? "1.0.0",
    description: overrides.description ?? "A test cartridge",
    actions: overrides.actions ?? [],
    requiredConnections: overrides.requiredConnections ?? [],
    defaultPolicies: overrides.defaultPolicies ?? [],
  };
}
