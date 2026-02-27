import type { TemplateContext } from "../generator.js";

export function indexTsTemplate(ctx: TemplateContext): string {
  return `import type {
  CartridgeManifest,
  ConnectionHealth,
  GuardrailConfig,
  RiskInput,
} from "@switchboard/schemas";
import type { Cartridge, CartridgeContext, ExecuteResult } from "@switchboard/cartridge-sdk";
import { ${ctx.constName}_MANIFEST } from "./manifest.js";
import { DEFAULT_${ctx.constName}_GUARDRAILS } from "./defaults/guardrails.js";
import { compute${ctx.pascalName}RiskInput } from "./risk/categories.js";

export class ${ctx.pascalName}Cartridge implements Cartridge {
  readonly manifest: CartridgeManifest = ${ctx.constName}_MANIFEST;

  async initialize(_context: CartridgeContext): Promise<void> {
    // Initialize provider connections here
  }

  async enrichContext(
    _actionType: string,
    _parameters: Record<string, unknown>,
    _context: CartridgeContext,
  ): Promise<Record<string, unknown>> {
    return {};
  }

  async execute(
    actionType: string,
    parameters: Record<string, unknown>,
    _context: CartridgeContext,
  ): Promise<ExecuteResult> {
    const start = Date.now();

    // TODO: Implement action execution logic
    return {
      success: true,
      summary: \`Executed \${actionType}\`,
      externalRefs: {},
      rollbackAvailable: false,
      partialFailures: [],
      durationMs: Date.now() - start,
      undoRecipe: null,
    };
  }

  async getRiskInput(
    actionType: string,
    parameters: Record<string, unknown>,
    _context: Record<string, unknown>,
  ): Promise<RiskInput> {
    return compute${ctx.pascalName}RiskInput(actionType, parameters);
  }

  getGuardrails(): GuardrailConfig {
    return DEFAULT_${ctx.constName}_GUARDRAILS;
  }

  async healthCheck(): Promise<ConnectionHealth> {
    return {
      status: "connected",
      latencyMs: 0,
      error: null,
      capabilities: [],
    };
  }
}
`;
}
