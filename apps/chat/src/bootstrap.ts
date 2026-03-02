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
  seedDefaultStorage,
  InMemoryLedgerStorage,
  AuditLedger,
  createGuardrailState,
  DEFAULT_REDACTION_CONFIG,
  GuardedCartridge,
  CartridgeReadAdapter,
  CapabilityRegistry,
  PlanGraphBuilder,
} from "@switchboard/core";
import { createGuardrailStateStore } from "./guardrail-state/index.js";
import { LifecycleOrchestrator as OrchestratorClass } from "@switchboard/core";
import { ApiOrchestratorAdapter } from "./api-orchestrator-adapter.js";
import { bootstrapDigitalAdsCartridge, DEFAULT_DIGITAL_ADS_POLICIES, createSnapshotCacheStore } from "@switchboard/digital-ads";
import { bootstrapQuantTradingCartridge, DEFAULT_TRADING_POLICIES } from "@switchboard/quant-trading";
import { bootstrapPaymentsCartridge, DEFAULT_PAYMENTS_POLICIES } from "@switchboard/payments";
import { bootstrapCrmCartridge, DEFAULT_CRM_POLICIES } from "@switchboard/crm";
import { TelegramApprovalNotifier } from "./notifications/telegram-notifier.js";
import { SlackApprovalNotifier } from "./notifications/slack-notifier.js";
import { WhatsAppApprovalNotifier } from "./notifications/whatsapp-notifier.js";
import { ChatRuntime } from "./runtime.js";
import type { ChatRuntimeConfig } from "./runtime.js";
import type { ChannelAdapter } from "./adapters/adapter.js";
import { FailedMessageStore } from "./dlq/failed-message-store.js";

/** Configuration for clinic mode (LLM interpreter + read tools). */
export interface ClinicConfig {
  clinicName?: string;
  adAccountId?: string;
  anthropicApiKey?: string;
  dailyTokenBudget?: number;
}

export interface ChatBootstrapResult {
  runtime: ChatRuntime;
  cleanup: () => void;
  failedMessageStore: FailedMessageStore | null;
}

export async function createChatRuntime(
  config?: Partial<ChatRuntimeConfig>,
  clinicConfig?: ClinicConfig,
): Promise<ChatBootstrapResult> {
  // Production startup guards
  if (process.env.NODE_ENV === "production") {
    if (!process.env["META_ADS_ACCESS_TOKEN"]) {
      throw new Error("META_ADS_ACCESS_TOKEN must be set in production");
    }
    if (!process.env["META_ADS_ACCOUNT_ID"]) {
      throw new Error("META_ADS_ACCOUNT_ID must be set in production");
    }
  }

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

    // Register digital-ads cartridge
    const { cartridge: adsCartridge, interceptors } = await bootstrapDigitalAdsCartridge({
      accessToken: process.env["META_ADS_ACCESS_TOKEN"] ?? "mock-token",
      adAccountId: process.env["META_ADS_ACCOUNT_ID"] ?? "act_mock",
      cacheStore: createSnapshotCacheStore(),
    });
    storage.cartridges.register("digital-ads", new GuardedCartridge(adsCartridge, interceptors));
    await seedDefaultStorage(storage, DEFAULT_DIGITAL_ADS_POLICIES);

    // Register quant-trading cartridge
    const { cartridge: tradingCartridge } = await bootstrapQuantTradingCartridge();
    storage.cartridges.register("quant-trading", new GuardedCartridge(tradingCartridge));
    await seedDefaultStorage(storage, DEFAULT_TRADING_POLICIES);

    // Register payments cartridge
    const { cartridge: paymentsCartridge } = await bootstrapPaymentsCartridge({
      secretKey: process.env["STRIPE_SECRET_KEY"] ?? "mock-key",
      requireCredentials: process.env.NODE_ENV === "production",
    });
    storage.cartridges.register("payments", new GuardedCartridge(paymentsCartridge));
    await seedDefaultStorage(storage, DEFAULT_PAYMENTS_POLICIES);

    // Register CRM cartridge (built-in, no external credentials needed)
    const { cartridge: crmCartridge } = await bootstrapCrmCartridge();
    storage.cartridges.register("crm", new GuardedCartridge(crmCartridge));
    await seedDefaultStorage(storage, DEFAULT_CRM_POLICIES);

    // Wire approval notifiers — fan out to all configured channels
    const notifiers: import("@switchboard/core").ApprovalNotifier[] = [];
    if (botToken) notifiers.push(new TelegramApprovalNotifier(botToken));
    const slackBotToken = process.env["SLACK_BOT_TOKEN"];
    if (slackBotToken) notifiers.push(new SlackApprovalNotifier(slackBotToken));
    const waToken = process.env["WHATSAPP_TOKEN"];
    const waPhoneId = process.env["WHATSAPP_PHONE_NUMBER_ID"];
    if (waToken && waPhoneId) notifiers.push(new WhatsAppApprovalNotifier({ token: waToken, phoneNumberId: waPhoneId }));

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

  // Clinic mode: use ClinicInterpreter + CartridgeReadAdapter
  const isClinicMode = clinicConfig || process.env["CLINIC_MODE"] === "true";
  let campaignRefreshTimer: ReturnType<typeof setInterval> | null = null;

  if (isClinicMode && !interpreter) {
    const { ClinicInterpreter } = await import("./clinic/interpreter.js");
    const { createModelRouter } = await import("./clinic/model-router-factory.js");

    const anthropicApiKey = clinicConfig?.anthropicApiKey ?? process.env["ANTHROPIC_API_KEY"] ?? "";
    const adAccountId = clinicConfig?.adAccountId ?? process.env["META_ADS_ACCOUNT_ID"] ?? "act_mock";

    // Create Redis client for model router if REDIS_URL is available
    let chatRedis: import("ioredis").default | undefined;
    const chatRedisUrl = process.env["REDIS_URL"];
    if (chatRedisUrl) {
      const { default: IORedis } = await import("ioredis");
      chatRedis = new IORedis(chatRedisUrl);
    }

    const modelRouter = createModelRouter({
      dailyTokenBudget: clinicConfig?.dailyTokenBudget ?? 100_000,
      clinicId: adAccountId,
    }, chatRedis);

    const clinicInterpreter = new ClinicInterpreter(
      {
        apiKey: anthropicApiKey,
        model: "claude-3-5-haiku-20241022",
        baseUrl: "https://api.anthropic.com",
      },
      {
        adAccountId,
        clinicName: clinicConfig?.clinicName ?? process.env["CLINIC_NAME"],
      },
      modelRouter,
    );
    interpreter = clinicInterpreter;

    // Create CartridgeReadAdapter for read intents
    if (storage && ledger && !readAdapter) {
      readAdapter = new CartridgeReadAdapter(storage, ledger);
    }

    // Load campaign names for LLM context grounding
    if (storage) {
      const cartridge = storage.cartridges.get("digital-ads");
      if (cartridge) {
        const loadCampaignNames = async () => {
          try {
            const campaigns = await cartridge.searchCampaigns?.("") ?? [];
            const names = campaigns.map((c) => c.name);
            clinicInterpreter.updateCampaignNames(names);
            return names.length;
          } catch (err) {
            console.warn("[Clinic] Failed to load campaign names:", err);
            return 0;
          }
        };

        const count = await loadCampaignNames();
        console.log(`[Clinic] Loaded ${count} campaign names`);

        // Refresh campaign names every 5 minutes
        campaignRefreshTimer = setInterval(loadCampaignNames, 5 * 60 * 1000);
      }
    }
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
    availableActions: config?.availableActions ?? [
      "digital-ads.campaign.pause",
      "digital-ads.campaign.resume",
      "digital-ads.campaign.adjust_budget",
      "digital-ads.adset.pause",
      "digital-ads.adset.resume",
      "digital-ads.adset.adjust_budget",
      "digital-ads.targeting.modify",
      "digital-ads.funnel.diagnose",
      "digital-ads.portfolio.diagnose",
      "digital-ads.snapshot.fetch",
      "digital-ads.structure.analyze",
      "trading.order.market_buy",
      "trading.order.market_sell",
      "trading.order.limit_buy",
      "trading.order.limit_sell",
      "trading.order.cancel",
      "trading.position.close",
      "trading.portfolio.rebalance",
      "trading.risk.set_stop_loss",
      "payments.invoice.create",
      "payments.invoice.void",
      "payments.charge.create",
      "payments.refund.create",
      "payments.subscription.cancel",
      "payments.subscription.modify",
      "payments.link.create",
      "payments.link.deactivate",
      "payments.credit.apply",
      "payments.batch.invoice",
      "crm.contact.search",
      "crm.contact.create",
      "crm.contact.update",
      "crm.deal.list",
      "crm.deal.create",
      "crm.activity.list",
      "crm.activity.log",
      "crm.pipeline.status",
      "crm.pipeline.diagnose",
      "crm.activity.analyze",
    ],
  });

  const cleanup = () => {
    if (campaignRefreshTimer) {
      clearInterval(campaignRefreshTimer);
    }
  };

  return { runtime, cleanup, failedMessageStore };
}

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
    availableActions: [
      "digital-ads.campaign.pause",
      "digital-ads.campaign.resume",
      "digital-ads.campaign.adjust_budget",
      "digital-ads.adset.pause",
      "digital-ads.adset.resume",
      "digital-ads.adset.adjust_budget",
      "digital-ads.targeting.modify",
      "digital-ads.funnel.diagnose",
      "digital-ads.portfolio.diagnose",
      "digital-ads.snapshot.fetch",
      "digital-ads.structure.analyze",
      "trading.order.market_buy",
      "trading.order.market_sell",
      "trading.order.limit_buy",
      "trading.order.limit_sell",
      "trading.order.cancel",
      "trading.position.close",
      "trading.portfolio.rebalance",
      "trading.risk.set_stop_loss",
      "payments.invoice.create",
      "payments.invoice.void",
      "payments.charge.create",
      "payments.refund.create",
      "payments.subscription.cancel",
      "payments.subscription.modify",
      "payments.link.create",
      "payments.link.deactivate",
      "payments.credit.apply",
      "payments.batch.invoice",
      "crm.contact.search",
      "crm.contact.create",
      "crm.contact.update",
      "crm.deal.list",
      "crm.deal.create",
      "crm.activity.list",
      "crm.activity.log",
      "crm.pipeline.status",
    ],
  });
}
