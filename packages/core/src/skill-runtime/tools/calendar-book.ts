import { randomUUID } from "node:crypto";
import type { SkillTool } from "../types.js";
import type { CalendarProvider, SlotQuery } from "@switchboard/schemas";

interface BookingStoreSubset {
  create(input: {
    organizationId: string;
    contactId: string;
    opportunityId?: string | null;
    service: string;
    startsAt: Date;
    endsAt: Date;
    timezone?: string;
    attendeeName?: string | null;
    attendeeEmail?: string | null;
    createdByType?: string;
    sourceChannel?: string | null;
    workTraceId?: string | null;
  }): Promise<{ id: string }>;
}

interface OpportunityStoreSubset {
  findActiveByContact(orgId: string, contactId: string): Promise<{ id: string } | null>;
  create(input: {
    organizationId: string;
    contactId: string;
    service: string;
  }): Promise<{ id: string }>;
}

type TransactionFn = (
  fn: (tx: {
    booking: {
      update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
    };
    outboxEvent: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
  }) => Promise<unknown>,
) => Promise<unknown>;

interface CalendarBookToolDeps {
  calendarProvider: CalendarProvider;
  bookingStore: BookingStoreSubset;
  opportunityStore: OpportunityStoreSubset;
  runTransaction: TransactionFn;
}

export function createCalendarBookTool(deps: CalendarBookToolDeps): SkillTool {
  return {
    id: "calendar-book",
    operations: {
      "slots.query": {
        description: "Query available calendar slots for a date range.",
        governanceTier: "read" as const,
        idempotent: true,
        inputSchema: {
          type: "object",
          properties: {
            dateFrom: { type: "string", description: "ISO 8601 start date" },
            dateTo: { type: "string", description: "ISO 8601 end date" },
            durationMinutes: { type: "number", description: "Appointment duration in minutes" },
            service: { type: "string", description: "Service type" },
            timezone: { type: "string", description: "IANA timezone" },
          },
          required: ["dateFrom", "dateTo", "durationMinutes", "service", "timezone"],
        },
        execute: async (params: unknown) => {
          const query = params as SlotQuery;
          return deps.calendarProvider.listAvailableSlots(query);
        },
      },
      "booking.create": {
        description:
          "Book a calendar slot for a contact. Persists booking, creates calendar event, emits booked event via outbox.",
        governanceTier: "external_write" as const,
        idempotent: true,
        inputSchema: {
          type: "object",
          properties: {
            orgId: { type: "string" },
            contactId: { type: "string" },
            service: { type: "string" },
            slotStart: { type: "string", description: "ISO 8601" },
            slotEnd: { type: "string", description: "ISO 8601" },
            calendarId: { type: "string" },
            attendeeName: { type: "string" },
            attendeeEmail: { type: "string" },
          },
          required: ["orgId", "contactId", "service", "slotStart", "slotEnd", "calendarId"],
        },
        execute: async (params: unknown) => {
          const input = params as {
            orgId: string;
            contactId: string;
            service: string;
            slotStart: string;
            slotEnd: string;
            calendarId: string;
            attendeeName?: string;
            attendeeEmail?: string;
          };

          // Resolve or create opportunity
          let opportunityId: string | null = null;
          const existing = await deps.opportunityStore.findActiveByContact(
            input.orgId,
            input.contactId,
          );
          if (existing) {
            opportunityId = existing.id;
          } else {
            const created = await deps.opportunityStore.create({
              organizationId: input.orgId,
              contactId: input.contactId,
              service: input.service,
            });
            opportunityId = created.id;
          }

          // 1. Persist booking as pending
          const booking = await deps.bookingStore.create({
            organizationId: input.orgId,
            contactId: input.contactId,
            opportunityId,
            service: input.service,
            startsAt: new Date(input.slotStart),
            endsAt: new Date(input.slotEnd),
            attendeeName: input.attendeeName ?? null,
            attendeeEmail: input.attendeeEmail ?? null,
          });

          // 2. Call calendar provider
          const calendarResult = await deps.calendarProvider.createBooking({
            contactId: input.contactId,
            organizationId: input.orgId,
            opportunityId,
            slot: {
              start: input.slotStart,
              end: input.slotEnd,
              calendarId: input.calendarId,
              available: true,
            },
            service: input.service,
            attendeeName: input.attendeeName,
            attendeeEmail: input.attendeeEmail,
          });

          // 3. On success: confirm booking + write outbox in one transaction
          const eventId = randomUUID();
          await deps.runTransaction(async (tx) => {
            await tx.booking.update({
              where: { id: booking.id },
              data: { status: "confirmed", calendarEventId: calendarResult.calendarEventId },
            });
            await tx.outboxEvent.create({
              data: {
                eventId,
                type: "booked",
                status: "pending",
                payload: {
                  type: "booked",
                  contactId: input.contactId,
                  organizationId: input.orgId,
                  opportunityId,
                  value: 0,
                  occurredAt: new Date().toISOString(),
                  source: "calendar-book",
                  metadata: {
                    bookingId: booking.id,
                    service: input.service,
                    slotStart: input.slotStart,
                    slotEnd: input.slotEnd,
                  },
                },
              },
            });
          });

          return {
            bookingId: booking.id,
            calendarEventId: calendarResult.calendarEventId,
            status: "confirmed",
            startsAt: input.slotStart,
            endsAt: input.slotEnd,
          };
        },
      },
    },
  };
}
