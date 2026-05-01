import { randomUUID } from "node:crypto";
import type { SkillTool, SkillRequestContext } from "../types.js";
import type { ToolResult } from "../tool-result.js";
import { ok, fail } from "../tool-result.js";
import type { CalendarProvider, SlotQuery } from "@switchboard/schemas";
import type { BookingFailureHandler } from "./booking-failure-handler.js";

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
  findBySlot(
    orgId: string,
    contactId: string,
    service: string,
    startsAt: Date,
  ): Promise<{ id: string } | null>;
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

function isPrismaUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "P2002"
  );
}

// Type duplicated locally because packages/core cannot import from apps/api.
// Structurally identical to apps/api/src/bootstrap/calendar-provider-factory.ts.
// If drift becomes a problem, hoist into @switchboard/schemas.
export type CalendarProviderFactory = (orgId: string) => Promise<CalendarProvider>;

interface CalendarBookToolDeps {
  calendarProviderFactory: CalendarProviderFactory;
  isCalendarProviderConfigured: (provider: CalendarProvider) => boolean;
  bookingStore: BookingStoreSubset;
  opportunityStore: OpportunityStoreSubset;
  runTransaction: TransactionFn;
  failureHandler: BookingFailureHandler;
}

const NOT_CONFIGURED_REMEDIATION =
  "Do not tell the customer there are no available slots. Escalate to the operator because calendar booking is not configured.";

async function resolveProviderOrFail(
  deps: Pick<CalendarBookToolDeps, "calendarProviderFactory" | "isCalendarProviderConfigured">,
  orgId: string,
): Promise<{ provider: CalendarProvider } | { failure: ToolResult }> {
  let provider: CalendarProvider;
  try {
    provider = await deps.calendarProviderFactory(orgId);
  } catch {
    return {
      failure: fail("CALENDAR_PROVIDER_ERROR", "Calendar provider could not be initialized.", {
        data: { calendarProviderResolved: false },
        retryable: false,
      }),
    };
  }
  if (!deps.isCalendarProviderConfigured(provider)) {
    return {
      failure: fail(
        "CALENDAR_NOT_CONFIGURED",
        "Calendar booking is not configured for this organization.",
        { modelRemediation: NOT_CONFIGURED_REMEDIATION, retryable: false },
      ),
    };
  }
  return { provider };
}

export type CalendarBookToolFactory = (ctx: SkillRequestContext) => SkillTool;

/**
 * Factory-with-context pattern (matches `escalate.ts`). The `orgId` is sourced
 * from the trusted `SkillRequestContext` injected at execution time, NEVER from
 * LLM-controlled tool input. This closes the AI-1 prompt-injection vector.
 */
export function createCalendarBookToolFactory(deps: CalendarBookToolDeps): CalendarBookToolFactory {
  return (ctx: SkillRequestContext): SkillTool => ({
    id: "calendar-book",
    operations: {
      "slots.query": {
        description: "Query available calendar slots for a date range.",
        effectCategory: "read" as const,
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
          const resolved = await resolveProviderOrFail(deps, ctx.orgId);
          if ("failure" in resolved) return resolved.failure;
          const slots = await resolved.provider.listAvailableSlots(query);
          return ok({ slots } as Record<string, unknown>);
        },
      },
      "booking.create": {
        description:
          "Book a calendar slot for a contact. Persists booking, creates calendar event, emits booked event via outbox.",
        effectCategory: "external_mutation" as const,
        idempotent: true,
        inputSchema: {
          type: "object",
          properties: {
            contactId: { type: "string" },
            service: { type: "string" },
            slotStart: { type: "string", description: "ISO 8601" },
            slotEnd: { type: "string", description: "ISO 8601" },
            calendarId: { type: "string" },
            attendeeName: { type: "string" },
            attendeeEmail: { type: "string" },
          },
          required: ["contactId", "service", "slotStart", "slotEnd", "calendarId"],
        },
        execute: async (params: unknown): Promise<ToolResult> => {
          const input = params as {
            contactId: string;
            service: string;
            slotStart: string;
            slotEnd: string;
            calendarId: string;
            attendeeName?: string;
            attendeeEmail?: string;
          };

          const orgId = ctx.orgId;
          const resolved = await resolveProviderOrFail(deps, orgId);
          if ("failure" in resolved) return resolved.failure;
          const provider = resolved.provider;

          // Resolve or create opportunity
          let opportunityId: string | null = null;
          const existing = await deps.opportunityStore.findActiveByContact(orgId, input.contactId);
          if (existing) {
            opportunityId = existing.id;
          } else {
            const created = await deps.opportunityStore.create({
              organizationId: orgId,
              contactId: input.contactId,
              service: input.service,
            });
            opportunityId = created.id;
          }

          // 1. Persist booking as pending (with duplicate guard)
          let booking: { id: string };
          try {
            booking = await deps.bookingStore.create({
              organizationId: orgId,
              contactId: input.contactId,
              opportunityId,
              service: input.service,
              startsAt: new Date(input.slotStart),
              endsAt: new Date(input.slotEnd),
              attendeeName: input.attendeeName ?? null,
              attendeeEmail: input.attendeeEmail ?? null,
            });
          } catch (err) {
            if (isPrismaUniqueConstraintError(err)) {
              const existingBooking = await deps.bookingStore.findBySlot(
                orgId,
                input.contactId,
                input.service,
                new Date(input.slotStart),
              );
              return fail(
                "DUPLICATE_BOOKING",
                "This time slot is already booked for this contact.",
                {
                  data: {
                    existingBookingId: existingBooking?.id ?? null,
                    status: "duplicate",
                    failureType: "duplicate_booking",
                  },
                },
              );
            }
            throw err;
          }

          // 2. Call calendar provider
          let calendarResult: { calendarEventId?: string | null };
          try {
            calendarResult = await provider.createBooking({
              contactId: input.contactId,
              organizationId: orgId,
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
              createdByType: "agent" as const,
            });
          } catch (error) {
            const failResult = await deps.failureHandler.handle({
              bookingId: booking.id,
              orgId,
              contactId: input.contactId,
              service: input.service,
              provider: "google_calendar",
              error,
              failureType: "provider_error",
              retryable: false,
            });
            return fail("BOOKING_FAILURE", failResult.message, {
              data: failResult as unknown as Record<string, unknown>,
            });
          }

          // 3. On success: confirm booking + write outbox in one transaction
          try {
            const eventId = randomUUID();
            await deps.runTransaction(async (tx) => {
              await tx.booking.update({
                where: { id: booking.id },
                data: {
                  status: "confirmed",
                  calendarEventId: calendarResult.calendarEventId,
                },
              });
              await tx.outboxEvent.create({
                data: {
                  eventId,
                  type: "booked",
                  status: "pending",
                  payload: {
                    type: "booked",
                    contactId: input.contactId,
                    organizationId: orgId,
                    value: 0,
                    occurredAt: new Date().toISOString(),
                    source: "calendar-book",
                    metadata: {
                      bookingId: booking.id,
                      opportunityId,
                      service: input.service,
                      slotStart: input.slotStart,
                      slotEnd: input.slotEnd,
                    },
                  },
                },
              });
            });
          } catch (error) {
            const failResult = await deps.failureHandler.handle({
              bookingId: booking.id,
              orgId,
              contactId: input.contactId,
              service: input.service,
              provider: "google_calendar",
              error,
              failureType: "confirmation_failed",
              retryable: true,
            });
            return fail("BOOKING_FAILURE", failResult.message, {
              data: failResult as unknown as Record<string, unknown>,
            });
          }

          return ok(
            {
              bookingId: booking.id,
              calendarEventId: calendarResult.calendarEventId,
              status: "confirmed",
              startsAt: input.slotStart,
              endsAt: input.slotEnd,
            },
            { entityState: { bookingId: booking.id, status: "confirmed" } },
          );
        },
      },
    },
  });
}
