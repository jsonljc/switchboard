import type { PrismaClient } from "@switchboard/db";
import type { IntentRegistry, ExecutionModeRegistry } from "@switchboard/core/platform";
import type { CalendarProvider } from "@switchboard/schemas";
import type { SkillExecutor, SkillDefinition } from "@switchboard/core/skill-runtime";

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
    createCrmWriteTool,
    createCalendarBookTool,
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
  const calendarProvider = await resolveCalendarProvider(prismaClient, logger);

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

  const baseTools = new Map([
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
  ]);

  // Schema-only instance for Anthropic tool registration; real execution uses per-request context.
  const toolsMap = new Map(baseTools);
  toolsMap.set(
    "escalate",
    escalateFactory({
      sessionId: "__schema_only__",
      orgId: "__schema_only__",
      deploymentId: "__schema_only__",
    }),
  );

  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const anthropicClient = new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] });
  const adapter = new AnthropicToolCallingAdapter(anthropicClient);
  const hooks = [new GovernanceHook(toolsMap)];
  const skillExecutor = new SkillExecutorImpl(adapter, toolsMap, undefined, hooks);

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

async function resolveCalendarProvider(
  prismaClient: PrismaClient,
  logger: { info(msg: string): void; error(msg: string): void },
  orgId?: string,
): Promise<CalendarProvider> {
  // Query org-specific config if orgId provided, otherwise fall back to first available
  let businessHours: import("@switchboard/schemas").BusinessHoursConfig | null = null;
  const orgConfig = orgId
    ? await prismaClient.organizationConfig.findFirst({
        where: { id: orgId },
        select: { businessHours: true },
      })
    : await prismaClient.organizationConfig.findFirst({
        select: { businessHours: true },
      });
  if (orgConfig?.businessHours && typeof orgConfig.businessHours === "object") {
    businessHours = orgConfig.businessHours as import("@switchboard/schemas").BusinessHoursConfig;
  }

  const credentials = process.env["GOOGLE_CALENDAR_CREDENTIALS"];
  const calendarId = process.env["GOOGLE_CALENDAR_ID"];

  // Option 1: Google Calendar if credentials present
  if (credentials && calendarId) {
    try {
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
      logger.error(`Calendar: failed to initialize Google Calendar: ${msg}`);
      // Fall through to local provider if business hours available
    }
  }

  // Option 2: Local provider if business hours configured
  if (businessHours) {
    if (!orgId) {
      throw new Error("resolveCalendarProvider: orgId required for LocalCalendarProvider path");
    }
    const { LocalCalendarProvider } = await import("@switchboard/core/calendar");

    const localStore = {
      findOverlapping: async (startsAt: Date, endsAt: Date) => {
        const rows = await prismaClient.booking.findMany({
          where: {
            organizationId: orgId,
            startsAt: { lt: endsAt },
            endsAt: { gt: startsAt },
            status: { notIn: ["cancelled", "failed"] },
          },
          select: { startsAt: true, endsAt: true },
        });
        return rows;
      },
      createInTransaction: async (input: {
        organizationId: string;
        contactId: string;
        opportunityId?: string | null;
        service: string;
        startsAt: Date;
        endsAt: Date;
        timezone: string;
        status: string;
        calendarEventId: string;
        attendeeName?: string | null;
        attendeeEmail?: string | null;
        createdByType: string;
        sourceChannel?: string | null;
        workTraceId?: string | null;
      }) => {
        return prismaClient.$transaction(async (tx) => {
          const conflicts = await tx.booking.findMany({
            where: {
              organizationId: input.organizationId,
              startsAt: { lt: input.endsAt },
              endsAt: { gt: input.startsAt },
              status: { notIn: ["cancelled", "failed"] },
            },
            select: { id: true },
            take: 1,
          });
          if (conflicts.length > 0) {
            throw new Error("SLOT_CONFLICT");
          }
          return tx.booking.create({
            data: {
              organizationId: input.organizationId,
              contactId: input.contactId,
              opportunityId: input.opportunityId ?? null,
              service: input.service,
              startsAt: input.startsAt,
              endsAt: input.endsAt,
              timezone: input.timezone,
              status: input.status,
              calendarEventId: input.calendarEventId,
              attendeeName: input.attendeeName ?? null,
              attendeeEmail: input.attendeeEmail ?? null,
              createdByType: input.createdByType,
              sourceChannel: input.sourceChannel ?? null,
              workTraceId: input.workTraceId ?? null,
            },
            select: { id: true },
          });
        });
      },
      findById: async (bookingId: string) => {
        const row = await prismaClient.booking.findUnique({ where: { id: bookingId } });
        if (!row) return null;
        return {
          id: row.id,
          contactId: row.contactId,
          organizationId: row.organizationId,
          opportunityId: row.opportunityId ?? null,
          service: row.service,
          status: row.status as "confirmed" | "cancelled" | "pending_confirmation",
          calendarEventId: row.calendarEventId ?? null,
          attendeeName: row.attendeeName ?? null,
          attendeeEmail: row.attendeeEmail ?? null,
          notes: null,
          createdByType: (row.createdByType ?? "agent") as "agent" | "human" | "contact",
          sourceChannel: row.sourceChannel ?? null,
          workTraceId: row.workTraceId ?? null,
          rescheduledAt: null,
          rescheduleCount: 0,
          startsAt: row.startsAt.toISOString(),
          endsAt: row.endsAt.toISOString(),
          timezone: row.timezone ?? "Asia/Singapore",
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        };
      },
      cancel: async (bookingId: string) => {
        await prismaClient.booking.update({
          where: { id: bookingId },
          data: { status: "cancelled" },
        });
      },
      reschedule: async (bookingId: string, newSlot: { start: string; end: string }) => {
        const updated = await prismaClient.booking.update({
          where: { id: bookingId },
          data: {
            startsAt: new Date(newSlot.start),
            endsAt: new Date(newSlot.end),
            rescheduleCount: { increment: 1 },
          },
          select: { id: true },
        });
        return { id: updated.id };
      },
    };

    const resendKey = process.env["RESEND_API_KEY"];
    const fromAddress = process.env["EMAIL_FROM"] ?? "noreply@switchboard.app";
    let emailSender: import("@switchboard/core/calendar").EmailSender | undefined;
    if (resendKey) {
      const { sendBookingConfirmationEmail } = await import("../lib/booking-confirmation-email.js");
      emailSender = async (email) => {
        await sendBookingConfirmationEmail({
          apiKey: resendKey,
          fromAddress,
          to: email.to,
          attendeeName: email.attendeeName,
          service: email.service,
          startsAt: email.startsAt,
          endsAt: email.endsAt,
          bookingId: email.bookingId,
        });
      };
    } else {
      logger.info("Calendar: booking confirmation emails disabled (RESEND_API_KEY not set)");
    }

    const provider = new LocalCalendarProvider({
      businessHours,
      bookingStore: localStore,
      ...(emailSender ? { emailSender } : {}),
      onSendFailure: ({ bookingId, error }) =>
        logger.error(`Calendar: booking confirmation email failed for ${bookingId}: ${error}`),
    });
    logger.info(
      "Calendar: using LocalCalendarProvider (business hours configured, no Google creds)",
    );
    return provider;
  }

  // Option 3: No provider available — use noop so the app still works
  const { NoopCalendarProvider } = await import("./noop-calendar-provider.js");
  logger.info("Calendar: using NoopCalendarProvider (no calendar configured, bookings disabled)");
  return new NoopCalendarProvider();
}
