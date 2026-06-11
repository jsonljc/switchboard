import type { PrismaClient } from "@switchboard/db";
import type { CalendarProviderFactory } from "../bootstrap/calendar-provider-factory.js";

export interface EraseContactDeps {
  prisma: PrismaClient;
  /** The contact store whose `delete` runs the PII cascade (which also purges
   *  WorkTrace + the DLQ inside its transaction — F5 parts a + b). */
  contactStore: { delete(orgId: string, contactId: string): Promise<void> };
  /** Resolves the org's calendar provider (global env creds today; see
   *  calendar-provider-factory). Injected so this helper stays unit-testable. */
  calendarProviderFactory: CalendarProviderFactory;
  logger?: { warn(obj: unknown, msg: string): void; error(obj: unknown, msg: string): void };
}

const ERASURE_REASON = "PDPA data erasure";

/**
 * Fully erase a contact for a PDPA right-to-erasure request (F5).
 *
 * Cancels the contact's external Google Calendar events FIRST (they are keyed by
 * `Booking.calendarEventId`, which the DB cascade is about to delete), then runs
 * `contactStore.delete` to remove the contact graph plus the audit log (WorkTrace)
 * and dead-letter queue (FailedMessage) — see PrismaContactStore.delete.
 *
 * The calendar cancel runs OUTSIDE any DB transaction (never call an external API
 * inside Prisma `$transaction`) and is best-effort: a provider/calendar failure is
 * logged but never blocks the DB erasure. The durable record of the request is the
 * `DataDeletionRequest` row, and ops can reconcile a lingering calendar event from
 * the logs — leaving patient PII in the database would be the worse outcome.
 *
 * Centralised here so any future erasure entrypoint inherits the complete cascade.
 */
export async function eraseContactFully(
  deps: EraseContactDeps,
  orgId: string,
  contactId: string,
): Promise<void> {
  // 1. Read external calendar event ids BEFORE deletion — contactStore.delete
  //    removes the Booking rows, so this must run first.
  const bookings = await deps.prisma.booking.findMany({
    where: { contactId, organizationId: orgId },
    select: { calendarEventId: true },
  });
  const calendarEventIds = bookings
    .map((b) => b.calendarEventId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  // 2. Cancel the external calendar events (best-effort, outside any DB tx).
  if (calendarEventIds.length > 0) {
    const provider = await resolveProvider(deps, orgId, contactId);
    if (provider) {
      for (const calendarEventId of calendarEventIds) {
        try {
          await provider.cancelBooking(calendarEventId, ERASURE_REASON);
        } catch (err) {
          deps.logger?.warn(
            { err, orgId, contactId, calendarEventId },
            "erase-contact: calendar event cancel failed; event may linger until reconciled",
          );
        }
      }
    }
  }

  // 3. Delete the contact graph + audit/DLQ PII (cascade in PrismaContactStore).
  await deps.contactStore.delete(orgId, contactId);
}

async function resolveProvider(
  deps: EraseContactDeps,
  orgId: string,
  contactId: string,
): Promise<Awaited<ReturnType<CalendarProviderFactory>> | null> {
  try {
    return await deps.calendarProviderFactory(orgId);
  } catch (err) {
    deps.logger?.error(
      { err, orgId, contactId },
      "erase-contact: calendar provider unresolved; proceeding with DB erasure",
    );
    return null;
  }
}
