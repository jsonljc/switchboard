import { TelegramAdapter } from "./adapters/telegram.js";
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
} from "@switchboard/core";
import { createGuardrailStateStore } from "./guardrail-state/index.js";
import { LifecycleOrchestrator as OrchestratorClass } from "@switchboard/core";
import { ApiOrchestratorAdapter } from "./api-orchestrator-adapter.js";
import { bootstrapAdsSpendCartridge, DEFAULT_ADS_POLICIES } from "@switchboard/ads-spend";
import { ChatRuntime } from "./runtime.js";
import type { ChatRuntimeConfig } from "./runtime.js";

/** Configuration for clinic mode (LLM interpreter + read tools). */
export interface ClinicConfig {
  clinicName?: string;
  adAccountId?: string;
  anthropicApiKey?: string;
  dailyTokenBudget?: number;
}

export async function createChatRuntime(
  config?: Partial<ChatRuntimeConfig>,
  clinicConfig?: ClinicConfig,
): Promise<ChatRuntime> {
  const botToken = process.env["TELEGRAM_BOT_TOKEN"] ?? "";
  const webhookSecret = process.env["TELEGRAM_WEBHOOK_SECRET"];
  const adapter = config?.adapter ?? new TelegramAdapter(botToken, undefined, webhookSecret);
  let interpreter: Interpreter | undefined = config?.interpreter;
  let readAdapter: CartridgeReadAdapterType | undefined = config?.readAdapter;

  let orchestrator = config?.orchestrator;
  let storage: StorageContext | undefined = config?.storage;

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

    // Register ads-spend cartridge
    const { cartridge: adsCartridge, interceptors } = await bootstrapAdsSpendCartridge({
      accessToken: process.env["META_ADS_ACCESS_TOKEN"] ?? "mock-token",
      adAccountId: process.env["META_ADS_ACCOUNT_ID"] ?? "act_mock",
    });
    storage.cartridges.register("ads-spend", new GuardedCartridge(adsCartridge, interceptors));
    await seedDefaultStorage(storage, DEFAULT_ADS_POLICIES);

    orchestrator = new OrchestratorClass({
      storage,
      ledger,
      guardrailState,
      guardrailStateStore,
    });
  }

  // Clinic mode: use ClinicInterpreter + CartridgeReadAdapter
  const isClinicMode = clinicConfig || process.env["CLINIC_MODE"] === "true";
  if (isClinicMode && !interpreter) {
    const { ClinicInterpreter } = await import("./clinic/interpreter.js");
    const { ModelRouter } = await import("./clinic/model-router.js");

    const anthropicApiKey = clinicConfig?.anthropicApiKey ?? process.env["ANTHROPIC_API_KEY"] ?? "";
    const adAccountId = clinicConfig?.adAccountId ?? process.env["META_ADS_ACCOUNT_ID"] ?? "act_mock";

    const modelRouter = new ModelRouter({
      dailyTokenBudget: clinicConfig?.dailyTokenBudget ?? 100_000,
      clinicId: adAccountId,
    });

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
      const cartridge = storage.cartridges.get("ads-spend");
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
        setInterval(loadCampaignNames, 5 * 60 * 1000);
      }
    }
  }

  if (!interpreter) {
    interpreter = new RuleBasedInterpreter();
  }

  // Build interpreter registry — always register the rule-based interpreter as a fallback
  const interpreterRegistry = new InterpreterRegistry();
  const ruleBasedInterpreter = new RuleBasedInterpreter();
  interpreterRegistry.register("rule-based", ruleBasedInterpreter, 1000);

  // Register the primary interpreter under a descriptive name
  if (interpreter !== ruleBasedInterpreter) {
    interpreterRegistry.register("primary", interpreter, 10);
  }

  interpreterRegistry.setDefaultFallbackChain(
    interpreter !== ruleBasedInterpreter ? ["primary", "rule-based"] : ["rule-based"],
  );

  return new ChatRuntime({
    adapter,
    interpreter,
    interpreterRegistry,
    orchestrator,
    storage,
    readAdapter,
    availableActions: config?.availableActions ?? [
      "ads.campaign.pause",
      "ads.campaign.resume",
      "ads.budget.adjust",
    ],
  });
}
