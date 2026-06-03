import type { SkillTool, SkillRequestContext } from "../types.js";
import type { ToolResult } from "../tool-result.js";
import { ok, fail } from "../tool-result.js";
import { getMetrics } from "../../telemetry/metrics.js";
import { isBookingSlotConflictError } from "@switchboard/schemas";
import type { CalendarProvider } from "@switchboard/schemas";
import { resolveProviderOrFail } from "./calendar-book.js";

type UpcomingBooking = {
  id: string;
  calendarEventId: string | null;
  service: string;
  startsAt: Date;
  endsAt: Date;
  status: string;
};

export interface CalendarRescheduleDeps {
  calendarProviderFactory: (orgId: string) => Promise<CalendarProvider>;
  isCalendarProviderConfigured: (p: CalendarProvider) => boolean;
  bookingStore: {
    findUpcomingByContact(orgId: string, contactId: string): Promise<UpcomingBooking[]>;
    reschedule(
      orgId: string,
      bookingId: string,
      slot: { startsAt: Date; endsAt: Date },
    ): Promise<unknown>;
    cancel(orgId: string, bookingId: string): Promise<unknown>;
  };
}

const NO_CONTACT = (): ToolResult =>
  fail("MISSING_CONTACT", "No contact is associated with this conversation.", {
    retryable: false,
    modelRemediation:
      "Escalate to the operator; do not change an appointment without an active contact.",
  });

// The booking is resolved from the trusted ctx.contactId, so a model-supplied
// contactId can never reach another contact's bookings. An optional `service`
// only narrows WITHIN the contact's own upcoming bookings (soonest-first).
function resolveTarget(bookings: UpcomingBooking[], service?: string): UpcomingBooking | undefined {
  const narrowed = service
    ? bookings.filter((b) => b.service.toLowerCase() === service.toLowerCase())
    : bookings;
  return (narrowed.length > 0 ? narrowed : bookings)[0];
}

export function buildRescheduleOperations(
  ctx: SkillRequestContext,
  deps: CalendarRescheduleDeps,
): SkillTool["operations"] {
  return {
    "booking.reschedule": {
      description:
        "Reschedule the contact's upcoming appointment to a new slot. The booking is resolved from the active contact — never pass a contactId.",
      effectCategory: "external_mutation" as const,
      idempotent: false,
      inputSchema: {
        type: "object",
        properties: {
          slotStart: { type: "string", description: "ISO 8601 new start" },
          slotEnd: { type: "string", description: "ISO 8601 new end" },
          calendarId: { type: "string" },
          service: {
            type: "string",
            description: "Optional: which service's appointment, if the lead has more than one",
          },
        },
        required: ["slotStart", "slotEnd", "calendarId"],
      },
      execute: async (params: unknown): Promise<ToolResult> => {
        const { orgId, contactId } = ctx;
        if (!contactId) return NO_CONTACT();
        const input = params as {
          slotStart: string;
          slotEnd: string;
          calendarId: string;
          service?: string;
        };
        const upcoming = await deps.bookingStore.findUpcomingByContact(orgId, contactId);
        const target = resolveTarget(upcoming, input.service);
        if (!target) {
          return fail("NO_UPCOMING_BOOKING", "I don't see an upcoming appointment to move.", {
            retryable: false,
            modelRemediation:
              "Tell the lead you don't see an upcoming booking and offer to book a new appointment.",
          });
        }
        const resolved = await resolveProviderOrFail(deps, orgId);
        if ("failure" in resolved) return resolved.failure;
        const provider = resolved.provider;
        const newSlot = {
          start: input.slotStart,
          end: input.slotEnd,
          calendarId: input.calendarId,
          available: true,
        };
        try {
          if (target.calendarEventId)
            await provider.rescheduleBooking(target.calendarEventId, newSlot);
          await deps.bookingStore.reschedule(orgId, target.id, {
            startsAt: new Date(input.slotStart),
            endsAt: new Date(input.slotEnd),
          });
        } catch (err) {
          // The store's overlap guard rejected the move: another LIVE booking
          // already holds the new slot. Recoverable — re-offer alternatives
          // instead of claiming the move failed for an unknown reason.
          if (isBookingSlotConflictError(err)) {
            getMetrics().bookingSlotConflict.inc({ orgId });
            return fail("SLOT_TAKEN", "That new time was just taken.", {
              retryable: true,
              data: { failureType: "slot_conflict" },
              modelRemediation:
                "Re-run calendar-book.slots.query and offer the lead the next available times for the reschedule.",
            });
          }
          console.warn("[calendar-reschedule] reschedule failed", err);
          return fail("RESCHEDULE_FAILURE", "I couldn't move that appointment just now.", {
            retryable: false,
            modelRemediation: "Apologize and escalate so a human can adjust the appointment.",
          });
        }
        getMetrics().bookingReschedule.inc({ orgId });
        return ok({
          bookingId: target.id,
          status: "rescheduled",
          service: target.service,
          startsAt: input.slotStart,
          endsAt: input.slotEnd,
        });
      },
    },
    "booking.cancel": {
      description:
        "Cancel the contact's upcoming appointment. Resolved from the active contact — never pass a contactId.",
      effectCategory: "external_mutation" as const,
      idempotent: false,
      inputSchema: {
        type: "object",
        properties: {
          service: {
            type: "string",
            description: "Optional: which service's appointment, if more than one",
          },
          reason: { type: "string", description: "Optional short reason" },
        },
        required: [],
      },
      execute: async (params: unknown): Promise<ToolResult> => {
        const { orgId, contactId } = ctx;
        if (!contactId) return NO_CONTACT();
        const input = params as { service?: string };
        const upcoming = await deps.bookingStore.findUpcomingByContact(orgId, contactId);
        const target = resolveTarget(upcoming, input.service);
        if (!target) {
          return fail("NO_UPCOMING_BOOKING", "I don't see an upcoming appointment to cancel.", {
            retryable: false,
            modelRemediation: "Tell the lead you don't see an upcoming booking to cancel.",
          });
        }
        const resolved = await resolveProviderOrFail(deps, orgId);
        if ("failure" in resolved) return resolved.failure;
        const provider = resolved.provider;
        try {
          if (target.calendarEventId) await provider.cancelBooking(target.calendarEventId);
          await deps.bookingStore.cancel(orgId, target.id);
        } catch (err) {
          console.warn("[calendar-reschedule] cancel failed", err);
          return fail("CANCEL_FAILURE", "I couldn't cancel that appointment just now.", {
            retryable: false,
            modelRemediation: "Apologize and escalate so a human can cancel the appointment.",
          });
        }
        getMetrics().bookingCancel.inc({ orgId });
        return ok({ bookingId: target.id, status: "cancelled", service: target.service });
      },
    },
  };
}
