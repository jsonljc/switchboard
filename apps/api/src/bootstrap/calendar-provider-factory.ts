import { type PrismaClient, type Prisma, acquireBookingLock } from "@switchboard/db";
import type { CalendarProvider, BusinessHoursConfig } from "@switchboard/schemas";
import { NoopCalendarProvider } from "./noop-calendar-provider.js";

export type CalendarProviderFactory = (orgId: string) => Promise<CalendarProvider>;

export interface CalendarProviderFactoryDeps {
  prismaClient: PrismaClient;
  // Matches the existing bootstrap logger shape (verified in Task 1).
  logger: { info(msg: string): void; error(msg: string): void };
  // Optional env injection for tests; falls back to process.env.
  env?: {
    GOOGLE_CALENDAR_CREDENTIALS?: string;
    GOOGLE_CALENDAR_ID?: string;
    RESEND_API_KEY?: string;
    EMAIL_FROM?: string;
  };
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
    RESEND_API_KEY: process.env["RESEND_API_KEY"],
    EMAIL_FROM: process.env["EMAIL_FROM"],
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

    const resendKey = env.RESEND_API_KEY;
    const fromAddress = env.EMAIL_FROM ?? "noreply@switchboard.app";
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
      deps.logger.info(
        `Calendar[${orgId}]: booking confirmation emails disabled (RESEND_API_KEY not set)`,
      );
    }

    const provider = new LocalCalendarProvider({
      businessHours,
      bookingStore: localStore,
      ...(emailSender ? { emailSender } : {}),
      onSendFailure: ({ bookingId, error }) =>
        deps.logger.error(
          `Calendar[${orgId}]: booking confirmation email failed for ${bookingId}: ${error}`,
        ),
    });
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

// Exported for the F12 focused unit + integration tests. This is not a public construction
// path; the calendar provider factory above is the only production caller.
export function buildLocalStore(prismaClient: PrismaClient, orgId: string) {
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
      // This store is bound to one org at construction. Refuse a payload whose org
      // disagrees so the advisory lock, overlap check, and insert can never key off
      // different orgs (F12).
      if (input.organizationId !== orgId) {
        throw new Error("ORGANIZATION_MISMATCH");
      }
      return prismaClient.$transaction(async (tx: Prisma.TransactionClient) => {
        // Serialize check-then-insert per org so two concurrent leads cannot both pass
        // the overlap check and double-book the same physical slot (F12). The shared
        // acquireBookingLock helper owns the ::int4 cast, so this path and the durable
        // PrismaBookingStore lock on the same key. Held until the transaction commits.
        await acquireBookingLock(tx, orgId);
        const conflicts = await tx.booking.findMany({
          where: {
            organizationId: orgId,
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
            organizationId: orgId,
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
      // Org-scope the cancel so a forged/guessed bookingId from another org cannot cancel
      // that org's booking (F12). A cancel cannot create a slot conflict, so no lock/overlap.
      // updateMany drops Prisma's P2025 not-found throw, so the count===0 guard rejects a
      // missing or cross-org id instead of silently no-op'ing.
      const result = await prismaClient.booking.updateMany({
        where: { id: bookingId, organizationId: orgId },
        data: { status: "cancelled" },
      });
      if (result.count === 0) {
        throw new Error("BOOKING_NOT_FOUND");
      }
    },
    reschedule: async (bookingId: string, newSlot: { start: string; end: string }) => {
      const startsAt = new Date(newSlot.start);
      const endsAt = new Date(newSlot.end);
      return prismaClient.$transaction(async (tx: Prisma.TransactionClient) => {
        // Serialize check-then-move per org (mirrors createInTransaction and the durable
        // PrismaBookingStore.reschedule) so a reschedule cannot land on a slot another LIVE
        // booking already holds. The shared acquireBookingLock helper owns the ::int4 cast;
        // held until the transaction commits.
        await acquireBookingLock(tx, orgId);
        // Org-scoped, half-open overlap excluding the booking being moved so a no-op or
        // shrink reschedule does not self-conflict.
        const conflicts = await tx.booking.findMany({
          where: {
            organizationId: orgId,
            id: { not: bookingId },
            startsAt: { lt: endsAt },
            endsAt: { gt: startsAt },
            status: { notIn: ["cancelled", "failed"] },
          },
          select: { id: true },
          take: 1,
        });
        if (conflicts.length > 0) {
          throw new Error("SLOT_CONFLICT");
        }
        // Org-scope the move. updateMany drops Prisma's P2025 not-found throw, so the
        // count===0 guard rejects a missing or cross-org id instead of silently no-op'ing (F12).
        const result = await tx.booking.updateMany({
          where: { id: bookingId, organizationId: orgId },
          data: {
            startsAt,
            endsAt,
            rescheduleCount: { increment: 1 },
          },
        });
        if (result.count === 0) {
          throw new Error("BOOKING_NOT_FOUND");
        }
        return { id: bookingId };
      });
    },
  };
}
