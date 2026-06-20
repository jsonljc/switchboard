import { type PrismaClient } from "@switchboard/db";
import type { CalendarProvider, BusinessHoursConfig } from "@switchboard/schemas";
import { NoopCalendarProvider } from "./noop-calendar-provider.js";
import { resolveOrgGoogleCalendarCreds } from "./deployment-calendar-creds.js";

export type CalendarProviderFactory = (orgId: string) => Promise<CalendarProvider>;

export interface CalendarProviderFactoryDeps {
  prismaClient: PrismaClient;
  // Matches the existing bootstrap logger shape (verified in Task 1).
  logger: { info(msg: string): void; error(msg: string): void };
  // Optional env injection for tests; falls back to process.env.
  env?: {
    GOOGLE_CALENDAR_CREDENTIALS?: string;
    GOOGLE_CALENDAR_ID?: string;
    GOOGLE_CALENDAR_CLIENT_ID?: string;
    GOOGLE_CALENDAR_CLIENT_SECRET?: string;
    RESEND_API_KEY?: string;
    EMAIL_FROM?: string;
  };
}

export function createCalendarProviderFactory(
  deps: CalendarProviderFactoryDeps,
): CalendarProviderFactory {
  // No eviction in beta (~10 orgs, process-lifetime cache mirrors today's
  // singleton lifetime per orgId). Production should add TTL or explicit
  // invalidation if calendar credentials/business hours can rotate at runtime
  // (including a clinic connecting its own Google Calendar via OAuth AFTER this
  // provider was first resolved; that org keeps its prior provider until restart).
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
    GOOGLE_CALENDAR_CLIENT_ID: process.env["GOOGLE_CALENDAR_CLIENT_ID"],
    GOOGLE_CALENDAR_CLIENT_SECRET: process.env["GOOGLE_CALENDAR_CLIENT_SECRET"],
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

  // Option 1: the clinic's OWN Google Calendar, from the per-deployment OAuth creds the
  // google-calendar-oauth callback stores (DeploymentConnection type "google_calendar").
  // Preferred over the shared global service account so each org's bookings land on its own
  // calendar. Needs the platform OAuth client creds to refresh access tokens; without them a
  // built provider could not refresh, so we skip straight to the fallbacks.
  if (env.GOOGLE_CALENDAR_CLIENT_ID && env.GOOGLE_CALENDAR_CLIENT_SECRET) {
    const oauthCreds = await resolveOrgGoogleCalendarCreds(deps.prismaClient, orgId);
    if (oauthCreds) {
      try {
        const { createGoogleCalendarProviderFromOAuth } =
          await import("./google-calendar-factory.js");
        const provider = await createGoogleCalendarProviderFromOAuth({
          clientId: env.GOOGLE_CALENDAR_CLIENT_ID,
          clientSecret: env.GOOGLE_CALENDAR_CLIENT_SECRET,
          refreshToken: oauthCreds.refreshToken,
          calendarId: oauthCreds.calendarId,
          businessHours,
        });
        const health = await provider.healthCheck();
        deps.logger.info(
          `Calendar[${orgId}]: connected org-owned Google Calendar via OAuth (${health.status}, ${health.latencyMs}ms)`,
        );
        return provider;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        deps.logger.error(
          `Calendar[${orgId}]: failed to initialize org-owned Google Calendar: ${msg}`,
        );
        // Fall through to the global service account / Local.
      }
    }
  }

  // Option 2: shared Google Calendar service account (global env), used when the org has not
  // connected its own calendar.
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

  // Option 3: Local provider (per-org businessHours).
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

  // Option 4: Noop.
  deps.logger.info(
    `Calendar[${orgId}]: using NoopCalendarProvider (no calendar configured, bookings disabled)`,
  );
  return new NoopCalendarProvider();
}

// Exported for the calendar provider integration tests. This is not a public construction
// path; the calendar provider factory above is the only production caller. The local provider
// reads through this store (free-slot computation + getBooking); the durable PrismaBookingStore
// owns every booking write (F12).
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
    findById: async (bookingId: string) => {
      const row = await prismaClient.booking.findFirst({
        where: { id: bookingId, organizationId: orgId },
      });
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
  };
}
