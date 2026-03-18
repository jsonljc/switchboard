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
  SkinLoader,
  SkinResolver,
  ToolRegistry,
  InMemoryGovernanceProfileStore,
  ProfileLoader,
  ProfileResolver,
  InMemoryConversionBus,
} from "@switchboard/core";
import type { ResolvedSkin, ResolvedProfile, AgentNotifier } from "@switchboard/core";
import type { BusinessProfile, CrmProvider } from "@switchboard/schemas";
import { createGuardrailStateStore } from "./guardrail-state/index.js";
import { LifecycleOrchestrator as OrchestratorClass } from "@switchboard/core";
import { ApiOrchestratorAdapter } from "./api-orchestrator-adapter.js";
import { TelegramApprovalNotifier } from "./notifications/telegram-notifier.js";
import { SlackApprovalNotifier } from "./notifications/slack-notifier.js";
import { WhatsAppApprovalNotifier } from "./notifications/whatsapp-notifier.js";
import { ChatRuntime } from "./runtime.js";
import type { ChatRuntimeConfig } from "./runtime.js";
import { FailedMessageStore } from "./dlq/failed-message-store.js";
import { registerAllCartridges, DEFAULT_CHAT_AVAILABLE_ACTIONS } from "./cartridge-registrar.js";
import { ResponseGenerator } from "./composer/response-generator.js";
import { ProactiveSender } from "./notifications/proactive-sender.js";
import {
  ConversationRouter,
  InMemorySessionStore,
  RedisSessionStore,
  qualificationFlow,
  bookingFlow,
  objectionHandlingFlow,
  reviewRequestFlow,
  postTreatmentFlow,
  resolveCadenceTemplates,
} from "@switchboard/customer-engagement";
import { startCadenceWorker, registerCadenceDefinition } from "./jobs/cadence-worker.js";

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
  /** AgentNotifier for proactive messaging from background agents. */
  agentNotifier: AgentNotifier | null;
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

  // Skin ID determines which vertical skin to load (e.g. "clinic", "gym")
  const skinIdEnv = process.env["SKIN_ID"];

  let resolvedSkin: ResolvedSkin | null = null;
  let resolvedProfile: ResolvedProfile | null = null;
  let crmProvider: CrmProvider | null = null;

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

    // Register all domain cartridges (with optional business profile)
    let businessProfile: BusinessProfile | undefined;
    const profileIdEnv = process.env["PROFILE_ID"];
    if (profileIdEnv) {
      const profilesDir = new URL("../../../profiles", import.meta.url).pathname;
      const profileLoader = new ProfileLoader(profilesDir);
      try {
        businessProfile = await profileLoader.load(profileIdEnv);
        console.warn(`[Chat] Business profile "${profileIdEnv}" loaded`);
      } catch (err) {
        console.warn(`[Chat] Failed to load business profile "${profileIdEnv}":`, err);
      }
    }

    const { crmProvider: registeredCrmProvider } = await registerAllCartridges(
      storage,
      businessProfile,
    );
    crmProvider = registeredCrmProvider;

    // --- Skin loading (optional, controlled by SKIN_ID env var) ---
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
      resolvedSkin = skinResolver.resolve(skin, toolRegistry);
      console.warn(
        `[Chat] Skin "${skinIdEnv}" loaded: ${resolvedSkin.tools.length} tools, profile=${resolvedSkin.governance.profile}`,
      );
    }

    // Resolve business profile for LLM context
    if (businessProfile) {
      const profileResolver = new ProfileResolver();
      resolvedProfile = profileResolver.resolve(businessProfile);
      console.warn(`[Chat] Business profile resolved for LLM context`);
    }

    // Create governance profile store and apply skin profile if loaded
    const governanceProfileStore = new InMemoryGovernanceProfileStore();
    if (resolvedSkin) {
      await governanceProfileStore.set(null, resolvedSkin.governance.profile);
      console.warn(
        `[Chat] Skin governance profile set as global default: ${resolvedSkin.governance.profile}`,
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

  // LLM interpreter mode: use SkinAwareInterpreter (when skin is loaded) or
  // ClinicInterpreter (legacy clinicConfig). Activated by skinIdEnv or clinicConfig.
  const useLlmInterpreter = skinIdEnv || clinicConfig;
  let campaignRefreshTimer: ReturnType<typeof setInterval> | null = null;
  let responseGenerator: ResponseGenerator | null = null;
  let llmConversationEngine:
    | import("./conversation/llm-conversation-engine.js").LLMConversationEngine
    | null = null;
  let llmBusinessProfile:
    | import("./conversation/llm-conversation-engine.js").BusinessProfile
    | null = null;

  // Create Redis client (shared by model router + session store)
  let chatRedis: import("ioredis").default | undefined;
  const chatRedisUrl = process.env["REDIS_URL"];
  if (chatRedisUrl) {
    const { default: IORedis } = await import("ioredis");
    chatRedis = new IORedis(chatRedisUrl);
  }

  if (useLlmInterpreter && !interpreter) {
    const { createModelRouter } = await import("./clinic/model-router-factory.js");

    const anthropicApiKey = clinicConfig?.anthropicApiKey ?? process.env["ANTHROPIC_API_KEY"] ?? "";
    const openaiApiKey = process.env["OPENAI_API_KEY"] ?? "";
    const adAccountId =
      clinicConfig?.adAccountId ?? process.env["META_ADS_ACCOUNT_ID"] ?? "act_mock";

    const modelRouter = createModelRouter(
      {
        dailyTokenBudget: clinicConfig?.dailyTokenBudget ?? 100_000,
        clinicId: adAccountId,
      },
      chatRedis,
    );

    // Select LLM provider: prefer Anthropic when available, fall back to OpenAI
    const llmConfig =
      openaiApiKey && !anthropicApiKey
        ? {
            apiKey: openaiApiKey,
            model: "gpt-4o-mini",
            baseUrl: "https://api.openai.com",
          }
        : {
            apiKey: anthropicApiKey,
            model: "claude-3-5-haiku-20241022" as const,
            baseUrl: "https://api.anthropic.com",
          };

    const clinicContext = {
      adAccountId,
      clinicName: clinicConfig?.clinicName ?? process.env["CLINIC_NAME"],
    };

    // Use SkinAwareInterpreter when a skin is loaded; fall back to ClinicInterpreter
    let llmInterpreter: Interpreter & { updateCampaignNames(names: string[]): void };
    if (skinIdEnv) {
      const { SkinAwareInterpreter } = await import("./interpreter/skin-aware-interpreter.js");
      llmInterpreter = new SkinAwareInterpreter(llmConfig, clinicContext, {
        skin: resolvedSkin,
        profile: resolvedProfile,
        modelRouter,
      });
    } else {
      const { ClinicInterpreter } = await import("./clinic/interpreter.js");
      llmInterpreter = new ClinicInterpreter(llmConfig, clinicContext, modelRouter);
    }
    interpreter = llmInterpreter;

    // Construct LLM-powered response generator (shares modelRouter with interpreter)
    if (llmConfig.apiKey) {
      responseGenerator = new ResponseGenerator({
        llmConfig: { ...llmConfig, maxTokens: 256, temperature: 0.4 },
        resolvedProfile,
        resolvedSkin,
        modelRouter,
      });
      console.warn("[Chat] ResponseGenerator initialized (LLM response generation enabled)");
    }

    // Create LLM Conversation Engine for lead bot natural responses
    if (llmConfig.apiKey) {
      const { LLMConversationEngine } = await import("./conversation/llm-conversation-engine.js");
      llmConversationEngine = new LLMConversationEngine(
        { ...llmConfig, maxTokens: 200, temperature: 0.6 },
        modelRouter,
      );
      console.warn("[Chat] LLMConversationEngine initialized (natural lead conversations enabled)");
    }

    // Build business profile for LLM conversation context
    if (resolvedProfile) {
      const biz = resolvedProfile.profile.business;
      const catalog = resolvedProfile.profile.services?.catalog;
      const hours = resolvedProfile.profile.hours;
      const booking = resolvedProfile.profile.booking;
      const faqs = resolvedProfile.profile.faqs;

      llmBusinessProfile = {
        businessName:
          biz?.name ?? resolvedProfile.profile.name ?? process.env["CLINIC_NAME"] ?? "our clinic",
        personaName: resolvedProfile.llmContext?.persona ?? "the team",
        services: catalog
          ?.map((s) => (s.typicalValue ? `${s.name} ($${s.typicalValue})` : s.name))
          .join(", "),
        hours: hours
          ? Object.entries(hours)
              .map(([day, h]) => `${day}: ${h.open}–${h.close}`)
              .join(", ")
          : undefined,
        bookingMethod: booking?.bookingUrl ?? booking?.bookingPhone ?? biz?.phone,
        faqs: faqs?.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join("\n"),
      };
    }

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
            llmInterpreter.updateCampaignNames(names);
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

  // Wire CAPIDispatcher to ConversionBus so lead bot events reach Meta CAPI (standalone mode)
  if (process.env["META_PIXEL_ID"] && process.env["META_ADS_ACCESS_TOKEN"]) {
    try {
      const { CAPIDispatcher, createMetaAdsWriteProvider } =
        await import("@switchboard/digital-ads");
      const adsProvider = createMetaAdsWriteProvider({
        accessToken: process.env["META_ADS_ACCESS_TOKEN"],
        adAccountId: process.env["META_ADS_ACCOUNT_ID"] ?? "act_mock",
      });
      const dispatcher = new CAPIDispatcher({
        adsProvider,
        crmProvider:
          crmProvider ??
          ({ searchContacts: async () => [], getContact: async () => null } as never),
        pixelId: process.env["META_PIXEL_ID"],
      });
      dispatcher.register(conversionBus);
      console.warn("[Chat] CAPIDispatcher registered on ConversionBus");
    } catch (err) {
      console.error("[Bootstrap] Failed to wire CAPIDispatcher:", err);
    }
  }

  // Lead bot mode: wire ConversationRouter when SKIN_ID is set and LEAD_BOT_MODE is enabled.
  // This routes lead messages through qualification → booking flows instead of the
  // owner/operator interpreter pipeline.
  let leadRouter: ConversationRouter | null = null;
  const isLeadBot = skinIdEnv && process.env["LEAD_BOT_MODE"] === "true";
  if (isLeadBot) {
    const sessionStore = chatRedis ? new RedisSessionStore(chatRedis) : new InMemorySessionStore();

    leadRouter = new ConversationRouter({
      sessionStore,
      flows: new Map([
        [qualificationFlow.id, qualificationFlow],
        [bookingFlow.id, bookingFlow],
        [objectionHandlingFlow.id, objectionHandlingFlow],
        [reviewRequestFlow.id, reviewRequestFlow],
        [postTreatmentFlow.id, postTreatmentFlow],
      ]),
      defaultFlowId: qualificationFlow.id,
      faqs: resolvedProfile?.profile?.faqs,
      businessName: resolvedProfile?.profile?.name,
      objectionTrees: resolvedProfile?.objectionTrees ?? [],
    });
    console.warn(
      `[Chat] Lead bot mode enabled: qualification → booking flow, ` +
        `session store=${chatRedis ? "redis" : "in-memory"}`,
    );
  }

  // Wire OutcomeStore for conversation outcome tracking (enables OutcomePipeline)
  let outcomeStore: import("@switchboard/core").OutcomeStore | undefined;
  if (process.env["DATABASE_URL"]) {
    const { getDb, PrismaOutcomeStore } = await import("@switchboard/db");
    outcomeStore = new PrismaOutcomeStore(getDb());
  }

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
    resolvedSkin,
    resolvedProfile,
    crmProvider,
    responseGenerator,
    dataFlowExecutor,
    conversionBus,
    isLeadBot: !!isLeadBot,
    leadRouter,
    outcomeStore,
    llmConversationEngine,
    llmBusinessProfile,
  });

  // Start cadence worker for follow-up automation when lead bot mode is enabled
  let stopCadenceWorker: (() => void) | null = null;
  if (isLeadBot) {
    // Register default cadence templates (consultation-reminder, post-treatment-followup, etc.)
    const templates = resolveCadenceTemplates();
    for (const template of templates) {
      registerCadenceDefinition(template);
    }

    let cadenceStore: import("@switchboard/db").CadenceStore | undefined;
    if (process.env["DATABASE_URL"]) {
      const { getDb, PrismaCadenceStore } = await import("@switchboard/db");
      cadenceStore = new PrismaCadenceStore(getDb());
    }

    stopCadenceWorker = startCadenceWorker({
      notifier: agentNotifier,
      cadenceStore,
      intervalMs: 5 * 60 * 1000, // Evaluate every 5 minutes
    });
  }

  // Silence detector — flags conversations with 72h+ of inactivity as unresponsive
  let stopSilenceDetector: (() => void) | null = null;
  if (isLeadBot && outcomeStore) {
    const { startSilenceDetector } = await import("./jobs/silence-detector.js");
    const { OutcomePipeline } = await import("@switchboard/core");
    const { getDb } = await import("@switchboard/db");
    stopSilenceDetector = startSilenceDetector({
      prisma: getDb(),
      outcomePipeline: new OutcomePipeline(outcomeStore),
    });
  }

  const cleanup = () => {
    if (campaignRefreshTimer) {
      clearInterval(campaignRefreshTimer);
    }
    if (stopCadenceWorker) {
      stopCadenceWorker();
    }
    if (stopSilenceDetector) {
      stopSilenceDetector();
    }
  };

  return { runtime, cleanup, failedMessageStore, agentNotifier };
}

// Re-export from dedicated module
export { createManagedRuntime } from "./managed-runtime.js";
