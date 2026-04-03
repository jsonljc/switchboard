import type { AgentContext, CartridgeContext, RoutedEventEnvelope } from "@switchboard/schemas";
import type { EmployeeConfig, CompiledEmployee, EmployeeContext } from "./types.js";
import { compileHandler } from "./compile-handler.js";
import { compileCartridge } from "./compile-cartridge.js";
import { compilePersonality } from "./compile-personality.js";
import { compileDefaults } from "./compile-defaults.js";

export function defineEmployee(config: EmployeeConfig): CompiledEmployee {
  validate(config);

  // Placeholder context factory — replaced at registration time with real services
  const personality = compilePersonality(config.personality);
  const placeholderCtx: EmployeeContext = {
    organizationId: "",
    knowledge: { search: async () => [] },
    memory: {
      brand: { search: async () => [] },
      skills: { getRelevant: async () => [] },
      performance: { getTop: async () => [] },
    },
    llm: { generate: async () => ({ text: "" }) },
    actions: {
      propose: async () => ({
        success: false,
        summary: "not wired",
        externalRefs: {},
        rollbackAvailable: false,
        partialFailures: [],
        durationMs: 0,
        undoRecipe: null,
      }),
    },
    emit: () => {},
    learn: async () => {},
    personality,
  };

  const handlerContextFactory = (_agentCtx: AgentContext, _event: RoutedEventEnvelope) =>
    placeholderCtx;
  const cartridgeContextFactory = (_ctx: CartridgeContext) => placeholderCtx;

  const port = {
    agentId: config.id,
    version: config.version,
    inboundEvents: config.inboundEvents,
    outboundEvents: config.outboundEvents,
    tools: [],
    configSchema: {},
  };

  return {
    port,
    handler: compileHandler(config, handlerContextFactory),
    cartridge: compileCartridge(config, cartridgeContextFactory),
    defaults: compileDefaults(config),
    connections: config.connections ?? [],
  };
}

function validate(config: EmployeeConfig): void {
  if (!config.id) throw new Error("Employee id is required");
  if (!config.name) throw new Error("Employee name is required");
  if (!config.version) throw new Error("Employee version is required");
  if (!config.inboundEvents.length) throw new Error("At least one inbound event is required");
  if (!config.actions.length) throw new Error("At least one action is required");
}
