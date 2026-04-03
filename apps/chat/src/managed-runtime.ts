import { RuleBasedInterpreter } from "./interpreter/interpreter.js";
import { InterpreterRegistry } from "./interpreter/registry.js";
import { ApiOrchestratorAdapter } from "./api-orchestrator-adapter.js";
import { ChatRuntime } from "./runtime.js";
import type { ChannelAdapter } from "./adapters/adapter.js";
import type { FailedMessageStore } from "./dlq/failed-message-store.js";
/** Default actions available in managed chat mode. */
const DEFAULT_CHAT_AVAILABLE_ACTIONS = [
  "digital-ads.campaign.pause",
  "digital-ads.campaign.resume",
  "digital-ads.campaign.adjust_budget",
  "digital-ads.funnel.diagnose",
  "digital-ads.portfolio.diagnose",
  "digital-ads.snapshot.fetch",
  "digital-ads.structure.analyze",
  "payments.refund.create",
  "payments.charge.create",
  "payments.invoice.create",
  "payments.subscription.cancel",
  "payments.credit.apply",
  "payments.link.create",
  "crm.contact.search",
  "crm.contact.create",
  "crm.contact.update",
  "crm.deal.list",
  "crm.deal.create",
  "crm.activity.list",
  "crm.activity.log",
  "crm.pipeline.status",
];

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
