/* eslint-disable max-lines -- bootstrap module: composes SkillExecutor + tool
   registry + governance gate + consent service + hook chain + Phase 3b
   QualificationEvaluationHook + LifecycleConfigResolver + LifecycleWriter wiring.
   Crossed the 600-line guideline at Phase 3b when the qualification hook
   construction was added (PR #444). Splitting (e.g. a separate
   `bootstrap/skill-mode-lifecycle.ts` for the 3b wiring) is tracked as a
   follow-up — better done when the broader bootstrap-module pattern is
   consolidated across this directory. */
import type { PrismaClient } from "@switchboard/db";
import type { IntentRegistry, ExecutionModeRegistry } from "@switchboard/core/platform";
import type {
  SkillExecutor,
  SkillDefinition,
  SkillToolFactory,
  WhatsAppWindowGateConfig,
} from "@switchboard/core/skill-runtime";
import type { ConsentService, ContactConsentReader, PlaybookReader } from "@switchboard/core";
import { createCalendarProviderFactory } from "./calendar-provider-factory.js";
import { isNoopCalendarProvider } from "./noop-calendar-provider.js";

export interface SkillModeBootstrapResult {
  simulationExecutor: SkillExecutor;
  alexSkill: SkillDefinition;
  // Phase 1c — exposed so the admin endpoint and gateway bridge can reuse.
  consentService: ConsentService;
  contactConsentReader: ContactConsentReader;
}

interface SkillModeBootstrapDeps {
  prismaClient: PrismaClient;
  intentRegistry: IntentRegistry;
  modeRegistry: ExecutionModeRegistry;
  logger: { info(msg: string): void; error(msg: string): void };
  /**
   * Phase 3b: optional. When provided, the executor fires the qualification
   * evaluation hook after a valid sidecar is parsed. If omitted, qualification
   * hook wiring is skipped (e.g. in test or environments without a playbook store).
   */
  playbookReader?: PlaybookReader;
  /**
   * Optional outcome-informed context builder. When provided, the Alex builder
   * injects OUTCOME_PATTERNS into the skill prompt. When absent, OUTCOME_PATTERNS
   * is an empty string and the template placeholder renders as a clean blank line.
   * Constructed in app.ts from conversationDeps.retriever + Prisma memory stores
   * so the same underlying DB client and embedding adapter are reused.
   */
  contextBuilder?: import("@switchboard/core").ContextBuilder;
  /**
   * Optional WorkTraceStore. When provided, PrismaOpportunityStore uses it to
   * emit WorkTrace entries on stage transitions. When absent, stage transitions
   * are persisted but not traced.
   */
}

export async function bootstrapSkillMode(
  deps: SkillModeBootstrapDeps,
): Promise<SkillModeBootstrapResult> {
  const { prismaClient, intentRegistry, modeRegistry, logger } = deps;

  const {
    loadSkill,
    SkillExecutorImpl,
    GovernanceHook,
    DeterministicSafetyGateHook,
    ClaimClassifierHook,
    PdpaConsentGateHook,
    WhatsAppWindowGateHook,
    AnthropicToolAdapter,
    BuilderRegistry,
    ContextResolverImpl,
    createCrmQueryTool,
    createCrmWriteToolFactory,
    createCalendarBookToolFactory,
    createEscalateToolFactory,
    BookingFailureHandler,
    createAgentDeploymentGovernanceResolver,
    InMemoryGovernancePostureCache,
    loadBannedPhrases,
    createAnthropicClaimClassifier,
    createSubstantiationResolver,
    createInMemoryLRU,
    loadRegulatoryPublicSources,
    loadRewriteTemplates,
    splitSentences,
    renderHandoffTemplate,
  } = await import("@switchboard/core/skill-runtime");
  const { SkillMode, registerSkillIntents } = await import("@switchboard/core/platform");
  const { HandoffPackageAssembler, HandoffNotifier, createConsentService } =
    await import("@switchboard/core");
  const {
    PrismaContactStore,
    PrismaOpportunityStore,
    PrismaActivityLogStore,
    PrismaBookingStore,
    PrismaHandoffStore,
    PrismaBusinessFactsStore,
    PrismaDeploymentStore,
    PrismaGovernanceVerdictStore,
    PrismaKnowledgeEntryStore,
    createPrismaApprovedComplianceClaimStore,
    createPrismaConsentStore,
    createPrismaContactConsentReader,
  } = await import("@switchboard/db");
  const { NoopNotifier, TelegramApprovalNotifier, CompositeNotifier } =
    await import("@switchboard/core/notifications");
  const { EmailEscalationNotifier } =
    await import("../services/notifications/email-escalation-notifier.js");

  if (!process.env["ANTHROPIC_API_KEY"]) {
    throw new Error("SkillMode requires ANTHROPIC_API_KEY");
  }

  const skillsDir = new URL("../../../../skills", import.meta.url).pathname;
  const alexSkill = loadSkill("alex", skillsDir);
  const skillsBySlug = new Map([[alexSkill.slug, alexSkill]]);

  registerSkillIntents(intentRegistry, [alexSkill]);

  const contactStore = new PrismaContactStore(prismaClient);
  const opportunityStore = new PrismaOpportunityStore(prismaClient);
  const activityStore = new PrismaActivityLogStore(prismaClient);
  const bookingStore = new PrismaBookingStore(prismaClient);
  const businessFactsStore = new PrismaBusinessFactsStore(prismaClient);
  // Live curated-knowledge resolver for SkillMode. Knowledge-entry only — the
  // alexBuilder owns BUSINESS_FACTS, so NO BusinessFactsStore is passed here.
  const knowledgeEntryStore = new PrismaKnowledgeEntryStore(prismaClient);
  const contextResolver = new ContextResolverImpl(knowledgeEntryStore);
  const calendarProviderFactory = createCalendarProviderFactory({ prismaClient, logger });

  const handoffStore = new PrismaHandoffStore(prismaClient);
  const handoffAssembler = new HandoffPackageAssembler();

  // ---------------------------------------------------------------------------
  // Deterministic safety gate infrastructure (Task 14)
  // Shared across the skill-executor hook and the channel-gateway pre-input gate
  // so that a posture warm-hit from the pre-output hook also benefits the gateway.
  // ---------------------------------------------------------------------------
  const deploymentStore = new PrismaDeploymentStore(prismaClient);
  const governanceConfigResolver = createAgentDeploymentGovernanceResolver(deploymentStore);
  const governanceVerdictStore = new PrismaGovernanceVerdictStore(prismaClient);
  // Single shared posture cache — warm on first resolve, reused across both gates.
  const governancePostureCache = new InMemoryGovernancePostureCache();
  // Adapter: ConversationStatusSetter → direct conversationState updateMany.
  //
  // WHY updateMany (not upsert):
  // ConversationState has required non-nullable fields (channel, principalId,
  // expiresAt) that this gate adapter does not possess — they are set upstream
  // in the chat conversation lifecycle (PrismaConversationStore.save) before
  // any message reaches the skill executor.  Upsert would require manufacturing
  // sentinel values for those fields, which defeats their purpose.
  //
  // Safety of updateMany here:
  // The DeterministicSafetyGateHook runs as an afterSkill hook inside the
  // SkillExecutorImpl.  By the time a session reaches the executor, the
  // conversation lifecycle (PrismaConversationStore) has already persisted a
  // ConversationState row for that threadId during session initialisation
  // (apps/chat/src/conversation/prisma-store.ts → save).  An updateMany with
  // no matching row is therefore a reachable-but-safe no-op only in edge cases
  // (e.g. brand-new session whose first-ever message triggered a banned phrase
  // before the lifecycle store wrote the row).  In that case the block is still
  // applied — the response is replaced and handoff is saved — only the status
  // flip is skipped.  The block still holds.
  //
  // Invariant: ConversationState rows are always written by the chat
  // conversation lifecycle before a session enters the skill executor.
  // Verified: apps/chat/src/conversation/prisma-store.ts save() is called by
  // the chat orchestrator prior to submitting to PlatformIngress.
  const conversationStatusSetter = {
    async setConversationStatus(sessionId: string, status: string): Promise<void> {
      await prismaClient.conversationState.updateMany({
        where: { threadId: sessionId },
        data: { status },
      });
    },
  };

  const telegramToken = process.env["TELEGRAM_BOT_TOKEN"];
  const escalationChatId = process.env["ESCALATION_CHAT_ID"];
  const resendApiKey = process.env["RESEND_API_KEY"];
  const escalationEmail = process.env["ESCALATION_EMAIL"];

  // Build notifier chain: email (default) + Telegram (optional)
  const notifiers: import("@switchboard/core/notifications").ApprovalNotifier[] = [];

  if (resendApiKey && escalationEmail) {
    notifiers.push(
      new EmailEscalationNotifier({
        resendApiKey,
        fromAddress: process.env["EMAIL_FROM"] ?? "noreply@switchboard.app",
        dashboardBaseUrl: process.env["NEXT_PUBLIC_APP_URL"] ?? "http://localhost:3002",
      }),
    );
    logger.info(`Escalation: email notifications enabled for ${escalationEmail}`);
  }

  if (telegramToken) {
    notifiers.push(new TelegramApprovalNotifier(telegramToken));
    logger.info(
      `Escalation: Telegram notifications enabled for chat ${escalationChatId ?? "(no chat ID)"}`,
    );
  }

  const approvalNotifier =
    notifiers.length > 1
      ? new CompositeNotifier(notifiers)
      : notifiers.length === 1
        ? notifiers[0]!
        : new NoopNotifier();

  const escalationApprovers: string[] = [];
  if (escalationEmail) escalationApprovers.push(escalationEmail);
  if (escalationChatId) escalationApprovers.push(escalationChatId);

  if (notifiers.length === 0) {
    logger.info("Escalation: no notification channels configured — handoff records saved only");
  }

  const handoffNotifier = new HandoffNotifier(approvalNotifier, escalationApprovers);

  const failureHandler = new BookingFailureHandler({
    runTransaction: (fn) =>
      prismaClient.$transaction((tx) =>
        fn({
          booking: tx.booking,
          escalationRecord: tx.escalationRecord,
          outboxEvent: tx.outboxEvent,
        }),
      ),
    bookingStore: {
      findById: async (bookingId: string) => {
        const b = await bookingStore.findById(bookingId);
        return b ? { id: b.id, status: b.status } : null;
      },
    },
    escalationLookup: {
      findByBookingId: async (bookingId: string) => {
        const records = await prismaClient.escalationRecord.findMany({
          where: {
            reason: "booking_failure",
            metadata: { path: ["bookingId"], equals: bookingId },
          },
          take: 1,
          orderBy: { createdAt: "desc" },
        });
        return records.length > 0 ? { id: records[0]!.id } : null;
      },
    },
  });

  const escalateFactory = createEscalateToolFactory({
    assembler: handoffAssembler,
    handoffStore,
    notifier: handoffNotifier,
  });

  const calendarBookFactory = createCalendarBookToolFactory({
    calendarProviderFactory,
    isCalendarProviderConfigured: (provider) => !isNoopCalendarProvider(provider),
    bookingStore,
    opportunityStore: {
      findActiveByContact: async (orgId: string, contactId: string) => {
        const active = await opportunityStore.findActiveByContact(orgId, contactId);
        return active.length > 0 ? { id: active[0]!.id } : null;
      },
      create: async (input: { organizationId: string; contactId: string; service: string }) => {
        const created = await opportunityStore.create({
          organizationId: input.organizationId,
          contactId: input.contactId,
          serviceId: input.service,
          serviceName: input.service,
        });
        return { id: created.id };
      },
    },
    runTransaction: (
      fn: (tx: {
        booking: {
          update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
        };
        outboxEvent: {
          create(args: { data: Record<string, unknown> }): Promise<unknown>;
        };
      }) => Promise<unknown>,
    ) =>
      prismaClient.$transaction((tx) => fn({ booking: tx.booking, outboxEvent: tx.outboxEvent })),
    failureHandler,
  });

  const crmWriteFactory = createCrmWriteToolFactory(opportunityStore, activityStore);

  // Per-request tool factories — the executor materializes a fresh tool per
  // execution with a trusted SkillRequestContext closed in. These are the
  // canonical execution path for trust-bound tools (AI-1).
  const toolFactories = new Map<string, SkillToolFactory>([
    ["calendar-book", calendarBookFactory],
    ["crm-write", crmWriteFactory],
    ["escalate", escalateFactory],
  ]);

  // Schema-only tool map for Anthropic tool registration & GovernanceHook.
  // Trust-bound tools are materialized with a synthetic context here to
  // expose their schemas; real execution dispatches against the runtime map.
  const SCHEMA_ONLY_CTX = {
    sessionId: "__schema_only__",
    orgId: "__schema_only__",
    deploymentId: "__schema_only__",
  };
  const toolsMap = new Map([
    ["crm-query", createCrmQueryTool(contactStore, activityStore)],
    ["crm-write", crmWriteFactory(SCHEMA_ONLY_CTX)],
    ["calendar-book", calendarBookFactory(SCHEMA_ONLY_CTX)],
    ["escalate", escalateFactory(SCHEMA_ONLY_CTX)],
  ]);

  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const anthropicClient = new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] });
  const adapter = new AnthropicToolAdapter(anthropicClient);

  // DeterministicSafetyGateHook registered BEFORE TracePersistenceHook (and any
  // future hooks that persist result.response) so the trace store never sees
  // pre-block unsafe text. Hook-runner iterates in registration-array order —
  // verified: hook-runner.ts uses sequential `for...of` loops, not Promise.all.
  const safetyGateHook = new DeterministicSafetyGateHook({
    governanceConfigResolver,
    bannedPhraseLoader: loadBannedPhrases,
    verdictStore: governanceVerdictStore,
    handoffStore,
    conversationStore: conversationStatusSetter,
    postureCache: governancePostureCache,
    clock: () => new Date(),
  });

  // ---------------------------------------------------------------------------
  // ClaimClassifierHook infrastructure (Task 15/16)
  // Runs AFTER DeterministicSafetyGateHook (deterministic banned-phrase / escalation
  // triggers have already fired by this point). Per spec §6.7 the posture cache is
  // a distinct instance — mixing with 1b-1's cache could cause fail-closed mode
  // contamination between the two independent governance gates.
  // Reuses the process-level anthropicClient constructed above — no new client.
  // ---------------------------------------------------------------------------
  const approvedClaimStore = createPrismaApprovedComplianceClaimStore(prismaClient);
  const substantiationCache = createInMemoryLRU();
  const substantiationResolver = createSubstantiationResolver({
    approvedClaimStore,
    regulatoryLoader: loadRegulatoryPublicSources,
    cache: substantiationCache,
    clock: () => new Date(),
  });
  const claimClassifier = createAnthropicClaimClassifier(anthropicClient);
  // Per-hook posture cache — separate instance from 1b-1's governancePostureCache.
  const claimClassifierPostureCache = new InMemoryGovernancePostureCache();

  const claimClassifierHook = new ClaimClassifierHook({
    governanceConfigResolver,
    postureCache: claimClassifierPostureCache,
    classifier: claimClassifier,
    substantiationResolver,
    rewriteLoader: loadRewriteTemplates,
    verdictStore: governanceVerdictStore,
    handoffStore,
    conversationStore: conversationStatusSetter,
    splitSentences,
    clock: () => new Date(),
    renderHandoff: renderHandoffTemplate,
  });

  // ---------------------------------------------------------------------------
  // PdpaConsentGateHook infrastructure (Phase 1c)
  // Runs AFTER ClaimClassifierHook. Per spec §7 the posture cache is a distinct
  // instance — third cache total (1b-1 deterministicGate, 1b-2 claimClassifier,
  // 1c consentState). Shared with the chat-process gateway revocation gate
  // when both processes run in the same deployment (each process has its own
  // in-memory cache — sharing is intra-process only).
  //
  // ConsentService construction-time binding to deploymentId/orgId/clinicType
  // is a v1 limitation: for the pilot envelope (one governed deployment per
  // tenant) this is acceptable, but Phase 2 should refactor ConsentService to
  // accept verdict-context per call. Tracked in:
  // docs/superpowers/plans/2026-05-11-alex-medspa-1c-followups.md
  // ---------------------------------------------------------------------------
  const consentStore = createPrismaConsentStore({ prisma: prismaClient });
  const contactConsentReader = createPrismaContactConsentReader({ prisma: prismaClient });
  const consentPostureCache = new InMemoryGovernancePostureCache();

  // sessionContactResolver: maps sessionId → contactId via ConversationThread.
  // Returns null on first-message turns where the thread row hasn't been
  // written yet. Both consent gates handle null as a graceful no-op.
  const sessionContactResolver = async (sessionId: string): Promise<string | null> => {
    const thread = await prismaClient.conversationThread.findFirst({
      where: { id: sessionId },
      select: { contactId: true },
    });
    return thread?.contactId ?? null;
  };

  const consentService = createConsentService({
    store: consentStore,
    verdictStore: governanceVerdictStore,
    handoffStore,
    conversationStore: conversationStatusSetter,
    clock: () => new Date(),
    // v1 placeholder bindings — see follow-up doc for Phase 2 refactor.
    deploymentId: "system:consent-service",
    orgId: "system",
    clinicType: "medical",
  });

  const pdpaConsentGateHook = new PdpaConsentGateHook({
    governanceConfigResolver,
    postureCache: consentPostureCache,
    consentService,
    contactConsentReader,
    sessionContactResolver,
    verdictStore: governanceVerdictStore,
    handoffStore,
    conversationStore: conversationStatusSetter,
    clock: () => new Date(),
  });

  // ---------------------------------------------------------------------------
  // WhatsAppWindowGateHook infrastructure (Phase 1d)
  // Runs AFTER PdpaConsentGateHook (1c consent must resolve before 1d window
  // check). Per spec §8 the posture cache is a distinct instance — fourth cache
  // total (1b-1, 1b-2, 1c, 1d). Feature flag
  // alexMedspaSgMyGovernanceV1.whatsappWindow.enabled defaults to false.
  // ---------------------------------------------------------------------------
  // Per-hook posture cache for WhatsAppWindowGateConfig. Cannot reuse
  // InMemoryGovernancePostureCache — it stores GovernancePosture (a different shape).
  const whatsAppWindowPostureCacheMap = new Map<string, WhatsAppWindowGateConfig>();
  const whatsAppWindowPostureCache = {
    lastKnown: (deploymentId: string) => whatsAppWindowPostureCacheMap.get(deploymentId),
    remember: (deploymentId: string, posture: WhatsAppWindowGateConfig) => {
      whatsAppWindowPostureCacheMap.set(deploymentId, posture);
    },
  };
  const whatsAppWindowGateHook = new WhatsAppWindowGateHook({
    verdictStore: governanceVerdictStore,
    handoffStore,
    governanceConfigResolver,
    postureCache: whatsAppWindowPostureCache,
    threadStore: {
      getLastWhatsAppInboundAt: async (threadId) => {
        const row = await prismaClient.conversationThread.findUnique({
          where: { id: threadId },
          select: { lastWhatsAppInboundAt: true },
        });
        return row?.lastWhatsAppInboundAt ?? null;
      },
    },
    contactStore: {
      getMessagingOptInForThread: async (threadId) => {
        const thread = await prismaClient.conversationThread.findUnique({
          where: { id: threadId },
          select: { lifecycleContact: { select: { messagingOptIn: true } } },
        });
        return thread?.lifecycleContact?.messagingOptIn ?? false;
      },
    },
    channelTypeResolver: {
      resolve: async (sessionId) => {
        const thread = await prismaClient.conversationThread.findUnique({
          where: { id: sessionId },
          select: { agentContext: true },
        });
        const ctx = (thread?.agentContext ?? {}) as { channel?: string };
        return ctx.channel ?? "unknown";
      },
    },
    clock: () => new Date(),
  });

  // ---------------------------------------------------------------------------
  // Phase 3b: qualification evaluation hook (optional — only wired when a
  // playbookReader is supplied by the caller).
  // ---------------------------------------------------------------------------
  let qualificationEvaluationHook:
    | import("@switchboard/core").QualificationEvaluationHook
    | undefined;
  if (deps.playbookReader) {
    const { LifecycleConfigResolver, LifecycleWriter, QualificationEvaluationHook } =
      await import("@switchboard/core");
    const { PrismaConversationLifecycleSnapshotStore, PrismaConversationLifecycleTransitionStore } =
      await import("@switchboard/db");
    const qSnapshotStore = new PrismaConversationLifecycleSnapshotStore(prismaClient);
    const qTransitionStore = new PrismaConversationLifecycleTransitionStore(prismaClient);
    // Adapt GovernanceConfigResolver (function) → { resolve } object.
    // LifecycleConfigResolver expects `{ resolve(orgId): Promise<unknown> }` while
    // GovernanceConfigResolver is a plain function `(deploymentId) => Promise<Resolution>`.
    // We use orgId as the resolution key (pilot: one deployment per org).
    const qConfigResolverAdapter = {
      resolve: async (orgId: string): Promise<unknown> => {
        const resolution = await governanceConfigResolver(orgId);
        if (resolution.status === "resolved") return resolution.config;
        return null;
      },
    };
    const qConfigResolver = new LifecycleConfigResolver({
      governanceConfigResolver: qConfigResolverAdapter,
    });
    const qWriter = new LifecycleWriter({
      snapshotStore: qSnapshotStore,
      transitionStore: qTransitionStore,
      runInTransaction: (fn) => prismaClient.$transaction(fn),
      resolveCapabilities: (orgId) => qConfigResolver.resolveCapabilities(orgId),
    });
    qualificationEvaluationHook = new QualificationEvaluationHook({
      writer: qWriter,
      snapshotStore: qSnapshotStore,
      playbookReader: deps.playbookReader,
      configResolver: qConfigResolver,
    });
    logger.info("Phase 3b: QualificationEvaluationHook wired to SkillExecutor");
  }

  const hooks = [
    new GovernanceHook(toolsMap),
    safetyGateHook,
    claimClassifierHook,
    pdpaConsentGateHook,
    whatsAppWindowGateHook,
  ];
  const skillExecutor = new SkillExecutorImpl(
    adapter,
    toolsMap,
    undefined,
    hooks,
    undefined,
    toolFactories,
    qualificationEvaluationHook,
  );

  const builderRegistry = new BuilderRegistry();

  const { alexBuilder } = await import("@switchboard/core/skill-runtime");
  const { resolveOutcomePatternsConfig } = await import("@switchboard/schemas");

  builderRegistry.register("alex", async (ctx) => {
    const agentContext = ctx.workUnit.parameters._agentContext as Parameters<typeof alexBuilder>[0];
    // PR-3.2e: resolve pilotMode from the deployment's inputConfig.outcomePatterns
    // namespace. Defaults to false when the namespace is absent, so steady-state
    // surfacing remains the default for every deployment.
    const { pilotMode } = resolveOutcomePatternsConfig(ctx.deployment.inputConfig ?? null);
    const config = {
      deploymentId: ctx.deployment.deploymentId,
      orgId: ctx.workUnit.organizationId,
      contactId: ctx.workUnit.parameters.contactId as string,
      phone: ctx.workUnit.parameters.phone as string | undefined,
      channel: ctx.workUnit.parameters.channel as string | undefined,
      message: ctx.workUnit.parameters._message as string | undefined,
      pilotMode,
    };
    const result = await alexBuilder(agentContext, config, ctx.stores, {
      contextBuilder: deps.contextBuilder,
    });
    return {
      parameters: result.parameters,
      metadata: { injectedPatternIds: result.injectedPatternIds },
    };
  });

  modeRegistry.register(
    new SkillMode({
      executor: skillExecutor,
      skillsBySlug,
      builderRegistry,
      contextResolver,
      stores: {
        opportunityStore: {
          findActiveByContact: async (orgId: string, contactId: string) =>
            opportunityStore.findActiveByContact(orgId, contactId),
          create: async (input: {
            organizationId: string;
            contactId: string;
            serviceId: string;
            serviceName: string;
          }) => {
            const created = await opportunityStore.create(input);
            return { id: created.id, stage: "interested" as const, createdAt: new Date() };
          },
        },
        contactStore: {
          findById: async (orgId: string, contactId: string) =>
            contactStore.findById(orgId, contactId),
          create: async (input: {
            organizationId: string;
            phone?: string | null;
            name?: string | null;
            primaryChannel: "whatsapp" | "telegram" | "dashboard";
            source?: string | null;
          }) => contactStore.create({ ...input, primaryChannel: input.primaryChannel }),
        },
        activityStore: {
          listByDeployment: async (orgId: string, deploymentId: string, opts: { limit: number }) =>
            activityStore.listByDeployment(orgId, deploymentId, opts),
        },
        businessFactsStore,
      },
    }),
  );

  // Startup assertion: verify gate deps reached SkillMode.
  // Missing deps cause silent gate degradation at runtime — fail fast instead.
  const missingGateDeps: string[] = [];
  // 1b-1 deterministic-gate deps
  if (!governanceConfigResolver) missingGateDeps.push("governanceConfigResolver");
  if (!governanceVerdictStore) missingGateDeps.push("verdictStore");
  if (!governancePostureCache) missingGateDeps.push("postureCache");
  if (!handoffStore) missingGateDeps.push("handoffStore");
  if (!conversationStatusSetter) missingGateDeps.push("conversationStatusSetter");
  if (!loadBannedPhrases) missingGateDeps.push("bannedPhraseLoader");
  // 1b-2 claim-classifier deps
  if (!claimClassifier) missingGateDeps.push("claimClassifier");
  if (!substantiationResolver) missingGateDeps.push("substantiationResolver");
  if (!claimClassifierPostureCache) missingGateDeps.push("claimClassifierPostureCache");
  // 1c pdpa-consent-gate deps
  if (!consentService) missingGateDeps.push("consentService");
  if (!contactConsentReader) missingGateDeps.push("contactConsentReader");
  if (!consentPostureCache) missingGateDeps.push("consentPostureCache");
  // 1d whatsapp-window-gate deps
  if (!whatsAppWindowPostureCache) missingGateDeps.push("whatsAppWindowPostureCache");
  // Construction-presence invariant: mirrors the other gate-dep checks. new ContextResolverImpl
  // throws synchronously on failure, so this is a belt-and-suspenders assertion, not a real catch.
  if (!contextResolver) missingGateDeps.push("contextResolver");
  if (missingGateDeps.length > 0) {
    throw new Error(`SkillMode: gate deps incomplete — missing: ${missingGateDeps.join(", ")}`);
  }

  logger.info(`SkillMode registered with ${skillsBySlug.size} skills and ${toolsMap.size} tools`);

  // Simulation executor: same adapter + tools, but with SimulationPolicyHook to block writes.
  // Pass toolFactories so read-effect tools (e.g. calendar-book.slots.query) materialize
  // against the simulation request's real orgId/SkillRequestContext rather than the
  // schema-only synthetic context. SimulationPolicyHook still blocks write/external_send/
  // external_mutation/irreversible operations.
  const { SimulationPolicyHook } = await import("@switchboard/core/skill-runtime");
  // Safety gate and claim classifier shared instances — same resolver/cache so simulation
  // shares posture warm-hits from the main executor. SimulationPolicyHook trails last to
  // block any write operations that survive governance filtering.
  const simulationHooks = [
    new GovernanceHook(toolsMap),
    safetyGateHook,
    claimClassifierHook,
    pdpaConsentGateHook,
    whatsAppWindowGateHook,
    new SimulationPolicyHook(),
  ];
  const simulationExecutor = new SkillExecutorImpl(
    adapter,
    toolsMap,
    undefined,
    simulationHooks,
    undefined,
    toolFactories,
  );

  return { simulationExecutor, alexSkill, consentService, contactConsentReader };
}
