import type { PrismaClient } from "@switchboard/db";
import type { IntentRegistry, ExecutionModeRegistry } from "@switchboard/core/platform";

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
  } = await import("@switchboard/core/skill-runtime");
  const { SkillMode, registerSkillIntents } = await import("@switchboard/core/platform");
  const { PrismaContactStore, PrismaOpportunityStore, PrismaActivityLogStore, PrismaBookingStore } =
    await import("@switchboard/db");

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

  const toolsMap = new Map([
    ["crm-query", createCrmQueryTool(contactStore, activityStore)],
    ["crm-write", createCrmWriteTool(opportunityStore, activityStore)],
    [
      "calendar-book",
      createCalendarBookTool({
        calendarProvider: {
          listAvailableSlots: async () => [],
          createBooking: async () => {
            throw new Error("Calendar provider not connected — provision a connection first");
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
        },
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
