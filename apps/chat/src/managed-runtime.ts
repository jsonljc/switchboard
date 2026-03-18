import { RuleBasedInterpreter } from "./interpreter/interpreter.js";
import { InterpreterRegistry } from "./interpreter/registry.js";
import { ApiOrchestratorAdapter } from "./api-orchestrator-adapter.js";
import { ChatRuntime } from "./runtime.js";
import type { ChannelAdapter } from "./adapters/adapter.js";
import type { FailedMessageStore } from "./dlq/failed-message-store.js";
import { DEFAULT_CHAT_AVAILABLE_ACTIONS } from "./cartridge-registrar.js";

/**
 * Create a lightweight managed runtime for provisioned channels.
 * Uses ApiOrchestratorAdapter — no local storage, cartridges, or orchestrator.
 * The API server handles all governance, policies, and audit.
 */
export async function createManagedRuntime(config: {
  adapter: ChannelAdapter;
  apiUrl: string;
  apiKey?: string;
  failedMessageStore?: FailedMessageStore;
}): Promise<ChatRuntime> {
  const apiAdapter = new ApiOrchestratorAdapter({
    baseUrl: config.apiUrl,
    apiKey: config.apiKey,
  });

  const interpreter = new RuleBasedInterpreter({
    diagnosticDefaults: { platform: "meta" },
  });
  const interpreterRegistry = new InterpreterRegistry();
  interpreterRegistry.register("rule-based", interpreter, 1000);
  interpreterRegistry.setDefaultFallbackChain(["rule-based"]);

  return new ChatRuntime({
    adapter: config.adapter,
    interpreter,
    interpreterRegistry,
    orchestrator: apiAdapter,
    failedMessageStore: config.failedMessageStore,
    availableActions: DEFAULT_CHAT_AVAILABLE_ACTIONS,
  });
}
