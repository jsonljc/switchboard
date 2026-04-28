import type { PrismaClient, Prisma } from "@switchboard/db";
import type { CalendarProvider, BusinessHoursConfig } from "@switchboard/schemas";
import { NoopCalendarProvider } from "./noop-calendar-provider.js";

export type CalendarProviderFactory = (orgId: string) => Promise<CalendarProvider>;

export interface CalendarProviderFactoryDeps {
  prismaClient: PrismaClient;
  // Matches the existing bootstrap logger shape (verified in Task 1).
  logger: { info(msg: string): void; error(msg: string): void };
  // Optional env injection for tests; falls back to process.env.
  env?: { GOOGLE_CALENDAR_CREDENTIALS?: string; GOOGLE_CALENDAR_ID?: string };
}

export function createCalendarProviderFactory(
  deps: CalendarProviderFactoryDeps,
): CalendarProviderFactory {
  // No eviction in beta (~10 orgs, process-lifetime cache mirrors today's
  // singleton lifetime per orgId). Production should add TTL or explicit
  // invalidation if calendar credentials/business hours can rotate at runtime.
  const cache = new Map<string, Promise<CalendarProvider>>();

  const factory: CalendarProviderFactory = (orgId: string) => {
    if (!orgId || typeof orgId !== "string" || orgId.trim() === "") {
      return Promise.reject(new Error("ORG_ID_REQUIRED"));
    }

    const existing = cache.get(orgId);
    if (existing) return existing;

    const promise = resolveForOrg(deps, orgId).catch((error) => {
      cache.delete(orgId);
      throw error;
    });

    cache.set(orgId, promise);
    return promise;
  };

  return factory;
}

async function resolveForOrg(
  deps: CalendarProviderFactoryDeps,
  orgId: string,
): Promise<CalendarProvider> {
  const env = deps.env ?? {
    GOOGLE_CALENDAR_CREDENTIALS: process.env["GOOGLE_CALENDAR_CREDENTIALS"],
    GOOGLE_CALENDAR_ID: process.env["GOOGLE_CALENDAR_ID"],
  };

  // Mirrors today's runtime query shape (skill-mode.ts resolveCalendarProvider,
  // confirmed in Task 1). Do not "fix" the field name in this PR.
  const orgConfig = await deps.prismaClient.organizationConfig.findFirst({
    where: { id: orgId },
    select: { businessHours: true },
  });

  let businessHours: BusinessHoursConfig | null = null;
  if (
    orgConfig?.businessHours &&
    typeof orgConfig.businessHours === "object" &&
    !Array.isArray(orgConfig.businessHours)
  ) {
    businessHours = orgConfig.businessHours as BusinessHoursConfig;
  }

  // Option 1: Google Calendar (global env today; per-org credentials is future work).
  if (env.GOOGLE_CALENDAR_CREDENTIALS && env.GOOGLE_CALENDAR_ID) {
    try {
      const { createGoogleCalendarProvider } = await import("./google-calendar-factory.js");
      const provider = await createGoogleCalendarProvider({
        credentials: env.GOOGLE_CALENDAR_CREDENTIALS,
        calendarId: env.GOOGLE_CALENDAR_ID,
        businessHours,
      });
      const health = await provider.healthCheck();
      deps.logger.info(
        `Calendar[${orgId}]: Google Calendar connected (${health.status}, ${health.latencyMs}ms)`,
      );
      return provider;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger.error(`Calendar[${orgId}]: failed to initialize Google Calendar: ${msg}`);
      // Fall through to Local if businessHours available.
    }
  }

  // Option 2: Local provider (per-org businessHours).
  if (businessHours) {
    const { LocalCalendarProvider } = await import("@switchboard/core/calendar");
    const localStore = buildLocalStore(deps.prismaClient, orgId);
    const provider = new LocalCalendarProvider({ businessHours, bookingStore: localStore });
    deps.logger.info(
      `Calendar[${orgId}]: using LocalCalendarProvider (business hours configured, no Google creds)`,
    );
    return provider;
  }

  // Option 3: Noop.
  deps.logger.info(
    `Calendar[${orgId}]: using NoopCalendarProvider (no calendar configured, bookings disabled)`,
  );
  return new NoopCalendarProvider();
}

function buildLocalStore(prismaClient: PrismaClient, orgId: string) {
  return {
    findOverlapping: async (startsAt: Date, endsAt: Date) => {
      return prismaClient.booking.findMany({
        where: {
          organizationId: orgId,
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
          status: { notIn: ["cancelled", "failed"] },
        },
        select: { startsAt: true, endsAt: true },
      });
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
      return prismaClient.$transaction(async (tx: Prisma.TransactionClient) => {
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
}
