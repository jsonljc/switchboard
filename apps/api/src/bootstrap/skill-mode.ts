import type { PrismaClient } from "@switchboard/db";
import type { IntentRegistry, ExecutionModeRegistry } from "@switchboard/core/platform";
import type {
  SkillExecutor,
  SkillDefinition,
  SkillToolFactory,
} from "@switchboard/core/skill-runtime";
import { createCalendarProviderFactory } from "./calendar-provider-factory.js";
import { isNoopCalendarProvider } from "./noop-calendar-provider.js";

export interface SkillModeBootstrapResult {
  simulationExecutor: SkillExecutor;
  alexSkill: SkillDefinition;
}

interface SkillModeBootstrapDeps {
  prismaClient: PrismaClient;
  intentRegistry: IntentRegistry;
  modeRegistry: ExecutionModeRegistry;
  logger: { info(msg: string): void; error(msg: string): void };
}

export async function bootstrapSkillMode(
  deps: SkillModeBootstrapDeps,
): Promise<SkillModeBootstrapResult> {
  const { prismaClient, intentRegistry, modeRegistry, logger } = deps;

  const {
    loadSkill,
    SkillExecutorImpl,
    GovernanceHook,
    AnthropicToolCallingAdapter,
    BuilderRegistry,
    createCrmQueryTool,
    createCrmWriteToolFactory,
    createCalendarBookToolFactory,
    createEscalateToolFactory,
    BookingFailureHandler,
  } = await import("@switchboard/core/skill-runtime");
  const { SkillMode, registerSkillIntents } = await import("@switchboard/core/platform");
  const { HandoffPackageAssembler, HandoffNotifier } = await import("@switchboard/core");
  const {
    PrismaContactStore,
    PrismaOpportunityStore,
    PrismaActivityLogStore,
    PrismaBookingStore,
    PrismaHandoffStore,
    PrismaBusinessFactsStore,
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
  const calendarProviderFactory = createCalendarProviderFactory({ prismaClient, logger });

  const handoffStore = new PrismaHandoffStore(prismaClient);
  const handoffAssembler = new HandoffPackageAssembler();

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
  const adapter = new AnthropicToolCallingAdapter(anthropicClient);
  const hooks = [new GovernanceHook(toolsMap)];
  const skillExecutor = new SkillExecutorImpl(
    adapter,
    toolsMap,
    undefined,
    hooks,
    undefined,
    toolFactories,
  );

  const builderRegistry = new BuilderRegistry();

  const { alexBuilder } = await import("@switchboard/core/skill-runtime");

  builderRegistry.register("alex", async (ctx) => {
    const agentContext = ctx.workUnit.parameters._agentContext as Parameters<typeof alexBuilder>[0];
    const config = {
      deploymentId: ctx.deployment.deploymentId,
      orgId: ctx.workUnit.organizationId,
      contactId: ctx.workUnit.parameters.contactId as string,
      phone: ctx.workUnit.parameters.phone as string | undefined,
      channel: ctx.workUnit.parameters.channel as string | undefined,
    };
    return alexBuilder(agentContext, config, ctx.stores);
  });

  modeRegistry.register(
    new SkillMode({
      executor: skillExecutor,
      skillsBySlug,
      builderRegistry,
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

  logger.info(`SkillMode registered with ${skillsBySlug.size} skills and ${toolsMap.size} tools`);

  // Simulation executor: same adapter + tools, but with SimulationPolicyHook to block writes
  const { SimulationPolicyHook } = await import("@switchboard/core/skill-runtime");
  const simulationHooks = [new GovernanceHook(toolsMap), new SimulationPolicyHook()];
  const simulationExecutor = new SkillExecutorImpl(adapter, toolsMap, undefined, simulationHooks);

  return { simulationExecutor, alexSkill };
}
