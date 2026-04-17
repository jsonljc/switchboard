import { TelegramAdapter } from "./adapters/telegram.js";
import type { PrincipalLookup } from "./adapters/telegram.js";
import { RuleBasedInterpreter } from "./interpreter/interpreter.js";
import type { Interpreter } from "./interpreter/interpreter.js";
import { InterpreterRegistry } from "./interpreter/registry.js";
import { setConversationStore } from "./conversation/threads.js";
import type {
  StorageContext,
  LedgerStorage,
  CartridgeReadAdapter as CartridgeReadAdapterType,
} from "@switchboard/core";
import {
  createInMemoryStorage,
  InMemoryLedgerStorage,
  AuditLedger,
  createGuardrailState,
  DEFAULT_REDACTION_CONFIG,
  CartridgeReadAdapter,
  CapabilityRegistry,
  PlanGraphBuilder,
  DataFlowExecutor,
  InMemoryGovernanceProfileStore,
  InMemoryConversionBus,
} from "@switchboard/core";
import type { AgentNotifier } from "@switchboard/core";
import { createGuardrailStateStore } from "./guardrail-state/index.js";
import { LifecycleOrchestrator as OrchestratorClass } from "@switchboard/core";
import { ApiOrchestratorAdapter } from "./api-orchestrator-adapter.js";
import { TelegramApprovalNotifier } from "./notifications/telegram-notifier.js";
import { SlackApprovalNotifier } from "./notifications/slack-notifier.js";
import { WhatsAppApprovalNotifier } from "./notifications/whatsapp-notifier.js";
import { ChatRuntime } from "./runtime.js";
import type { ChatRuntimeConfig } from "./runtime.js";
import { FailedMessageStore } from "./dlq/failed-message-store.js";
import { ProactiveSender } from "./notifications/proactive-sender.js";

/** Default actions available in chat mode. */
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

export interface ChatBootstrapResult {
  runtime: ChatRuntime;
  cleanup: () => void;
  failedMessageStore: FailedMessageStore | null;
  /** AgentNotifier for proactive messaging from background agents. */
  agentNotifier: AgentNotifier | null;
}

export async function createChatRuntime(
  config?: Partial<ChatRuntimeConfig>,
): Promise<ChatBootstrapResult> {
  const botToken = process.env["TELEGRAM_BOT_TOKEN"] ?? "";
  const webhookSecret = process.env["TELEGRAM_WEBHOOK_SECRET"];
  let interpreter: Interpreter | undefined = config?.interpreter;
  let readAdapter: CartridgeReadAdapterType | undefined = config?.readAdapter;

  let orchestrator = config?.orchestrator;
  let storage: StorageContext | undefined = config?.storage;

  // Instantiate DLQ store when a database is available
  let failedMessageStore: FailedMessageStore | null = null;
  if (process.env["DATABASE_URL"]) {
    const { getDb } = await import("@switchboard/db");
    failedMessageStore = new FailedMessageStore(getDb());
  }

  // Optional: single choke point via Switchboard API (propose/execute/approvals over HTTP)
  const apiUrl = process.env["SWITCHBOARD_API_URL"];
  if (!orchestrator && apiUrl) {
    const apiAdapter = new ApiOrchestratorAdapter({
      baseUrl: apiUrl,
      apiKey: process.env["SWITCHBOARD_API_KEY"],
    });
    orchestrator = apiAdapter;
  }

  let ledger: AuditLedger | undefined;

  if (!orchestrator) {
    // Create storage — use Prisma when DATABASE_URL is set, otherwise in-memory
    let ledgerStorage: LedgerStorage;

    if (process.env["DATABASE_URL"]) {
      const { getDb, createPrismaStorage, PrismaLedgerStorage } = await import("@switchboard/db");
      const { PrismaConversationStore } = await import("./conversation/prisma-store.js");
      const prisma = getDb();
      storage = createPrismaStorage(prisma);
      ledgerStorage = new PrismaLedgerStorage(prisma);
      setConversationStore(new PrismaConversationStore(prisma));
    } else {
      storage = createInMemoryStorage();
      ledgerStorage = new InMemoryLedgerStorage();
    }

    ledger = new AuditLedger(ledgerStorage, DEFAULT_REDACTION_CONFIG);
    const guardrailState = createGuardrailState();
    const guardrailStateStore = createGuardrailStateStore();

    // Create governance profile store
    const governanceProfileStore = new InMemoryGovernanceProfileStore();

    // Wire approval notifiers — fan out to all configured channels
    const notifiers: import("@switchboard/core").ApprovalNotifier[] = [];
    if (botToken) notifiers.push(new TelegramApprovalNotifier(botToken));
    const slackBotToken = process.env["SLACK_BOT_TOKEN"];
    if (slackBotToken) notifiers.push(new SlackApprovalNotifier(slackBotToken));
    const waToken = process.env["WHATSAPP_TOKEN"];
    const waPhoneId = process.env["WHATSAPP_PHONE_NUMBER_ID"];
    if (waToken && waPhoneId)
      notifiers.push(new WhatsAppApprovalNotifier({ token: waToken, phoneNumberId: waPhoneId }));

    let approvalNotifier: import("@switchboard/core").ApprovalNotifier | undefined;
    if (notifiers.length > 1) {
      const { CompositeNotifier } = await import("@switchboard/core");
      approvalNotifier = new CompositeNotifier(notifiers);
    } else if (notifiers.length === 1) {
      approvalNotifier = notifiers[0];
    }

    orchestrator = new OrchestratorClass({
      storage,
      ledger,
      guardrailState,
      guardrailStateStore,
      governanceProfileStore,
      approvalNotifier,
    });
  }

  // Wire principalLookup for organizationId resolution from the principal store
  let principalLookup: PrincipalLookup | undefined;
  if (storage) {
    principalLookup = async (principalId: string) => {
      const principal = await storage!.identity.getPrincipal(principalId);
      return principal ? { organizationId: principal.organizationId } : null;
    };
  }
  const adapter = config?.adapter ?? new TelegramAdapter(botToken, principalLookup, webhookSecret);

  // Create CartridgeReadAdapter for read intents
  if (storage && ledger && !readAdapter) {
    readAdapter = new CartridgeReadAdapter(storage, ledger);
  }

  if (!interpreter) {
    interpreter = new RuleBasedInterpreter({
      diagnosticDefaults: {
        platform: "meta",
        entityId: process.env["META_ADS_ACCOUNT_ID"] ?? "act_mock",
      },
    });
  }

  // Build interpreter registry — always register the rule-based interpreter as a fallback
  const interpreterRegistry = new InterpreterRegistry();
  const ruleBasedInterpreter = new RuleBasedInterpreter({
    diagnosticDefaults: {
      platform: "meta",
      entityId: process.env["META_ADS_ACCOUNT_ID"] ?? "act_mock",
    },
  });
  interpreterRegistry.register("rule-based", ruleBasedInterpreter, 1000);

  // Register the primary interpreter under a descriptive name
  if (interpreter !== ruleBasedInterpreter) {
    interpreterRegistry.register("primary", interpreter, 10);
  }

  interpreterRegistry.setDefaultFallbackChain(
    interpreter !== ruleBasedInterpreter ? ["primary", "rule-based"] : ["rule-based"],
  );

  // Build capability registry from registered cartridge manifests
  const capabilityRegistry = new CapabilityRegistry();
  if (storage) {
    for (const cartridgeId of storage.cartridges.list()) {
      const cartridge = storage.cartridges.get(cartridgeId);
      if (cartridge) {
        capabilityRegistry.populateFromManifest(cartridge.manifest.actions);
      }
    }
  }
  const planGraphBuilder = new PlanGraphBuilder();

  // Create DataFlowExecutor for multi-step plan execution
  let dataFlowExecutor: InstanceType<typeof DataFlowExecutor> | null = null;
  if (orchestrator && "propose" in orchestrator) {
    dataFlowExecutor = new DataFlowExecutor({
      orchestrator: orchestrator as unknown as import("@switchboard/core").DataFlowOrchestrator,
    });
  }

  // Create ProactiveSender for agent notifications
  const agentNotifier: AgentNotifier = new ProactiveSender({
    telegram: botToken ? { botToken } : undefined,
    slack: process.env["SLACK_BOT_TOKEN"]
      ? { botToken: process.env["SLACK_BOT_TOKEN"] }
      : undefined,
    whatsapp:
      process.env["WHATSAPP_TOKEN"] && process.env["WHATSAPP_PHONE_NUMBER_ID"]
        ? {
            token: process.env["WHATSAPP_TOKEN"],
            phoneNumberId: process.env["WHATSAPP_PHONE_NUMBER_ID"],
          }
        : undefined,
  });

  // Create ConversionBus for CRM → ads attribution feedback loop
  const conversionBus = new InMemoryConversionBus();

  const runtime = new ChatRuntime({
    adapter,
    interpreter,
    interpreterRegistry,
    orchestrator,
    storage,
    readAdapter,
    capabilityRegistry,
    planGraphBuilder,
    failedMessageStore: failedMessageStore ?? undefined,
    availableActions: config?.availableActions ?? DEFAULT_CHAT_AVAILABLE_ACTIONS,
    crmProvider: null,
    dataFlowExecutor,
    conversionBus,
    isLeadBot: false,
  });

  const cleanup = () => {
    // No background workers to clean up
  };

  return { runtime, cleanup, failedMessageStore, agentNotifier };
}

// Re-export from dedicated module
export { createManagedRuntime } from "./managed-runtime.js";
