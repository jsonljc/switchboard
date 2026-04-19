import type { PrismaClient } from "@switchboard/db";
import type { IntentRegistry, ExecutionModeRegistry } from "@switchboard/core/platform";
import type { CalendarProvider } from "@switchboard/schemas";

interface SkillModeBootstrapDeps {
  prismaClient: PrismaClient;
  intentRegistry: IntentRegistry;
  modeRegistry: ExecutionModeRegistry;
  logger: { info(msg: string): void; error(msg: string): void };
}

export async function bootstrapSkillMode(deps: SkillModeBootstrapDeps): Promise<void> {
  const { prismaClient, intentRegistry, modeRegistry, logger } = deps;

  const {
    loadSkill,
    SkillExecutorImpl,
    AnthropicToolCallingAdapter,
    BuilderRegistry,
    createCrmQueryTool,
    createCrmWriteTool,
    createCalendarBookTool,
    createEscalateTool,
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
  } = await import("@switchboard/db");
  const { NoopNotifier } = await import("@switchboard/core/notifications");

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
  const calendarProvider = await resolveCalendarProvider(prismaClient, logger);

  const handoffStore = new PrismaHandoffStore(prismaClient);
  const handoffAssembler = new HandoffPackageAssembler();
  const handoffNotifier = new HandoffNotifier(new NoopNotifier());

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

  const toolsMap = new Map([
    ["crm-query", createCrmQueryTool(contactStore, activityStore)],
    ["crm-write", createCrmWriteTool(opportunityStore, activityStore)],
    [
      "calendar-book",
      createCalendarBookTool({
        calendarProvider,
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
              update(args: {
                where: { id: string };
                data: Record<string, unknown>;
              }): Promise<unknown>;
            };
            outboxEvent: {
              create(args: { data: Record<string, unknown> }): Promise<unknown>;
            };
          }) => Promise<unknown>,
        ) =>
          prismaClient.$transaction((tx) =>
            fn({ booking: tx.booking, outboxEvent: tx.outboxEvent }),
          ),
        failureHandler,
      }),
    ],
    [
      "escalate",
      createEscalateTool({
        assembler: handoffAssembler,
        handoffStore,
        notifier: handoffNotifier,
        sessionContext: {
          sessionId: "",
          organizationId: "",
          leadSnapshot: { channel: "whatsapp" },
          qualificationSnapshot: { signalsCaptured: {}, qualificationStage: "unknown" },
          messages: [],
        },
      }),
    ],
  ]);

  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const anthropicClient = new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] });
  const adapter = new AnthropicToolCallingAdapter(anthropicClient);
  const skillExecutor = new SkillExecutorImpl(adapter, toolsMap);

  const builderRegistry = new BuilderRegistry();

  modeRegistry.register(
    new SkillMode({
      executor: skillExecutor,
      skillsBySlug,
      builderRegistry,
      stores: {
        opportunityStore: {
          findActiveByContact: async (orgId: string, contactId: string) =>
            opportunityStore.findActiveByContact(orgId, contactId),
        },
        contactStore: {
          findById: async (orgId: string, contactId: string) =>
            contactStore.findById(orgId, contactId),
        },
        activityStore: {
          listByDeployment: async (orgId: string, deploymentId: string, opts: { limit: number }) =>
            activityStore.listByDeployment(orgId, deploymentId, opts),
        },
      },
    }),
  );

  logger.info(`SkillMode registered with ${skillsBySlug.size} skills and ${toolsMap.size} tools`);
}

const STUB_CALENDAR_PROVIDER: CalendarProvider = {
  listAvailableSlots: async () => [],
  createBooking: async () => {
    throw new Error("Calendar provider not connected — set GOOGLE_CALENDAR_CREDENTIALS");
  },
  cancelBooking: async () => {
    throw new Error("Calendar provider not connected");
  },
  rescheduleBooking: async () => {
    throw new Error("Calendar provider not connected");
  },
  getBooking: async () => null,
  healthCheck: async () => ({
    status: "disconnected" as const,
    latencyMs: 0,
    error: "No calendar connection provisioned",
  }),
};

async function resolveCalendarProvider(
  prismaClient: PrismaClient,
  logger: { info(msg: string): void; error(msg: string): void },
): Promise<CalendarProvider> {
  const credentials = process.env["GOOGLE_CALENDAR_CREDENTIALS"];
  const calendarId = process.env["GOOGLE_CALENDAR_ID"];

  if (!credentials || !calendarId) {
    logger.info("Calendar: no GOOGLE_CALENDAR_CREDENTIALS or GOOGLE_CALENDAR_ID — using stub");
    return STUB_CALENDAR_PROVIDER;
  }

  try {
    // Read business hours from the first org config that has them
    let businessHours: import("@switchboard/schemas").BusinessHoursConfig | null = null;
    const orgConfig = await prismaClient.organizationConfig.findFirst({
      select: { businessHours: true },
    });
    if (orgConfig?.businessHours && typeof orgConfig.businessHours === "object") {
      businessHours = orgConfig.businessHours as import("@switchboard/schemas").BusinessHoursConfig;
    }

    const { createGoogleCalendarProvider } = await import("./google-calendar-factory.js");
    const provider = await createGoogleCalendarProvider({
      credentials,
      calendarId,
      businessHours,
    });

    const health = await provider.healthCheck();
    logger.info(`Calendar: Google Calendar connected (${health.status}, ${health.latencyMs}ms)`);
    return provider;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Calendar: failed to initialize Google Calendar — falling back to stub: ${msg}`);
    return STUB_CALENDAR_PROVIDER;
  }
}
