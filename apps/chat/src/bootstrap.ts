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
  SkinLoader,
  SkinResolver,
  ToolRegistry,
} from "@switchboard/core";
import type { ResolvedSkin } from "@switchboard/core";
import { createGuardrailStateStore } from "./guardrail-state/index.js";
import { LifecycleOrchestrator as OrchestratorClass } from "@switchboard/core";
import { ApiOrchestratorAdapter } from "./api-orchestrator-adapter.js";
import { TelegramApprovalNotifier } from "./notifications/telegram-notifier.js";
import { SlackApprovalNotifier } from "./notifications/slack-notifier.js";
import { WhatsAppApprovalNotifier } from "./notifications/whatsapp-notifier.js";
import { ChatRuntime } from "./runtime.js";
import type { ChatRuntimeConfig } from "./runtime.js";
import type { ChannelAdapter } from "./adapters/adapter.js";
import { FailedMessageStore } from "./dlq/failed-message-store.js";
import { registerAllCartridges, DEFAULT_CHAT_AVAILABLE_ACTIONS } from "./cartridge-registrar.js";

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

  // --- CLINIC_MODE backward compatibility ---
  // Maps CLINIC_MODE=true → SKIN_ID=clinic with a deprecation warning.
  let skinIdEnv = process.env["SKIN_ID"];
  if (!skinIdEnv && process.env["CLINIC_MODE"] === "true") {
    console.warn("[Chat] CLINIC_MODE is deprecated. Use SKIN_ID=clinic instead.");
    skinIdEnv = "clinic";
  }

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

    // Register all domain cartridges
    await registerAllCartridges(storage);

    // --- Skin loading (optional, controlled by SKIN_ID env var) ---
    let _resolvedSkin: ResolvedSkin | null = null;
    if (skinIdEnv) {
      const skinsDir = new URL("../../../skins", import.meta.url).pathname;
      const skinLoader = new SkinLoader(skinsDir);
      const skinResolver = new SkinResolver();
      const toolRegistry = new ToolRegistry();

      for (const cartridgeId of storage.cartridges.list()) {
        const cartridge = storage.cartridges.get(cartridgeId);
        if (cartridge) {
          toolRegistry.registerCartridge(cartridgeId, cartridge.manifest);
        }
      }

      const skin = await skinLoader.load(skinIdEnv);
      _resolvedSkin = skinResolver.resolve(skin, toolRegistry);
      console.warn(
        `[Chat] Skin "${skinIdEnv}" loaded: ${_resolvedSkin.tools.length} tools, profile=${_resolvedSkin.governance.profile}`,
      );
    }

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
  // Activated by clinicConfig or skin with clinic ID
  const isClinicMode = clinicConfig || skinIdEnv === "clinic";
  let campaignRefreshTimer: ReturnType<typeof setInterval> | null = null;

  if (isClinicMode && !interpreter) {
    const { ClinicInterpreter } = await import("./clinic/interpreter.js");
    const { createModelRouter } = await import("./clinic/model-router-factory.js");

    const anthropicApiKey = clinicConfig?.anthropicApiKey ?? process.env["ANTHROPIC_API_KEY"] ?? "";
    const adAccountId =
      clinicConfig?.adAccountId ?? process.env["META_ADS_ACCOUNT_ID"] ?? "act_mock";

    // Create Redis client for model router if REDIS_URL is available
    let chatRedis: import("ioredis").default | undefined;
    const chatRedisUrl = process.env["REDIS_URL"];
    if (chatRedisUrl) {
      const { default: IORedis } = await import("ioredis");
      chatRedis = new IORedis(chatRedisUrl);
    }

    const modelRouter = createModelRouter(
      {
        dailyTokenBudget: clinicConfig?.dailyTokenBudget ?? 100_000,
        clinicId: adAccountId,
      },
      chatRedis,
    );

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
            const searchFn = (
              cartridge as unknown as {
                searchCampaigns?: (q: string) => Promise<Array<{ name: string }>>;
              }
            ).searchCampaigns;
            const campaigns = searchFn ? await searchFn("") : [];
            const names = campaigns.map((c) => c.name);
            clinicInterpreter.updateCampaignNames(names);
            return names.length;
          } catch (err) {
            console.warn("[Clinic] Failed to load campaign names:", err);
            return 0;
          }
        };

        const count = await loadCampaignNames();
        console.warn(`[Clinic] Loaded ${count} campaign names`);

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
    availableActions: config?.availableActions ?? DEFAULT_CHAT_AVAILABLE_ACTIONS,
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
    availableActions: DEFAULT_CHAT_AVAILABLE_ACTIONS,
  });
}
