import type { SkillTool, SkillRequestContext } from "../types.js";
import type { ToolResult } from "../tool-result.js";
import { ok, fail } from "../tool-result.js";
import { getMetrics } from "../../telemetry/metrics.js";
import { isBookingSlotConflictError } from "@switchboard/schemas";
import type { CalendarProvider } from "@switchboard/schemas";
import { resolveProviderOrFail } from "./calendar-book.js";
import { parseSlotWindowOrFail } from "./slot-window.js";

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

// The lead asked for a service that matches none of their upcoming bookings. Surface the
// bookings they DO hold so the model asks which one they mean, mirroring NO_UPCOMING_BOOKING
// (a recoverable conversational failure, not a human escalation) rather than acting on an
// unrelated appointment.
const NO_MATCHING = (verb: "move" | "cancel", availableServices: string[]): ToolResult =>
  fail("NO_MATCHING_BOOKING", `I don't see a matching appointment to ${verb}.`, {
    retryable: false,
    data: { availableServices },
    modelRemediation:
      `The contact's upcoming appointments are: ${availableServices.join(", ")}. ` +
      `Ask which one they mean before you ${verb} it; do not ${verb} an appointment they did not name.`,
  });

// The booking is resolved from the trusted ctx.contactId, so a model-supplied contactId can
// never reach another contact's bookings. An optional `service` narrows WITHIN the contact's
// own upcoming bookings (soonest-first). When a `service` is supplied but matches NONE of the
// contact's bookings we MUST NOT fall back to an unrelated booking: acting on the soonest-of-all
// would reschedule/cancel the WRONG appointment (e.g. a "botox" request landing on a "filler"
// booking). Surface no_match so the caller asks which appointment.
type TargetResolution =
  | { kind: "ok"; booking: UpcomingBooking }
  | { kind: "none" }
  | { kind: "no_match"; availableServices: string[] };

function resolveTarget(bookings: UpcomingBooking[], service?: string): TargetResolution {
  const soonest = bookings[0];
  if (!soonest) return { kind: "none" };
  if (!service) return { kind: "ok", booking: soonest };
  // Case-insensitive + trimmed exact match, matching the service-name matching convention in
  // booking-value.ts so a model-supplied "  Botox " still matches a stored "botox" booking.
  const narrowed = bookings.filter(
    (b) => b.service.trim().toLowerCase() === service.trim().toLowerCase(),
  );
  const match = narrowed[0];
  if (!match) {
    return { kind: "no_match", availableServices: [...new Set(bookings.map((b) => b.service))] };
  }
  return { kind: "ok", booking: match };
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
      // Reschedule/cancel act on an ALREADY-confirmed booking. Like booking.create,
      // auto-approve at the DEFAULT real-org "supervised" trust AND at "guided": the
      // in-skill approval hook cannot park, so a gate here dead-ends — Alex would tell
      // the lead "I've moved/cancelled your appointment" while the change never
      // persisted. Scoped to these operations (NOT a blanket external_mutation
      // relaxation); the deferred park-for-review posture is the F2 work.
      governanceOverride: { supervised: "auto-approve" as const, guided: "auto-approve" as const },
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
        // P2-2 — validate the LLM-supplied slot window BEFORE resolving the target
        // or touching the provider/store. An unparseable date would otherwise reach
        // provider.rescheduleBooking (a spurious calendar move) and the durable
        // reschedule (Invalid Date), where the throw is mis-classified as a
        // human-escalate RESCHEDULE_FAILURE. A recoverable, retryable fail steers
        // the model to re-issue a valid slot with no side effect.
        const parsedWindow = parseSlotWindowOrFail(input.slotStart, input.slotEnd);
        if ("failure" in parsedWindow) return parsedWindow.failure;
        const upcoming = await deps.bookingStore.findUpcomingByContact(orgId, contactId);
        const resolution = resolveTarget(upcoming, input.service);
        if (resolution.kind === "none") {
          return fail("NO_UPCOMING_BOOKING", "I don't see an upcoming appointment to move.", {
            retryable: false,
            modelRemediation:
              "Tell the lead you don't see an upcoming booking and offer to book a new appointment.",
          });
        }
        if (resolution.kind === "no_match")
          return NO_MATCHING("move", resolution.availableServices);
        const target = resolution.booking;
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
          // The provider may have already moved the calendar event to the new slot before
          // the durable write rejected. Best-effort revert it to the original slot so the
          // calendar and DB don't diverge — symmetric with booking.create's orphan
          // compensation; idempotent if the provider never actually moved it.
          if (target.calendarEventId) {
            try {
              await provider.rescheduleBooking(target.calendarEventId, {
                start: target.startsAt.toISOString(),
                end: target.endsAt.toISOString(),
                calendarId: input.calendarId,
                available: true,
              });
            } catch (revertErr) {
              console.warn("[calendar-reschedule] revert-on-failure failed", revertErr);
            }
          }
          // The store's overlap guard rejected the move: another LIVE booking already holds
          // the new slot. Recoverable — re-offer alternatives.
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
      // Reschedule/cancel act on an ALREADY-confirmed booking. Like booking.create,
      // auto-approve at the DEFAULT real-org "supervised" trust AND at "guided": the
      // in-skill approval hook cannot park, so a gate here dead-ends — Alex would tell
      // the lead "I've moved/cancelled your appointment" while the change never
      // persisted. Scoped to these operations (NOT a blanket external_mutation
      // relaxation); the deferred park-for-review posture is the F2 work.
      governanceOverride: { supervised: "auto-approve" as const, guided: "auto-approve" as const },
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
        const resolution = resolveTarget(upcoming, input.service);
        if (resolution.kind === "none") {
          return fail("NO_UPCOMING_BOOKING", "I don't see an upcoming appointment to cancel.", {
            retryable: false,
            modelRemediation: "Tell the lead you don't see an upcoming booking to cancel.",
          });
        }
        if (resolution.kind === "no_match")
          return NO_MATCHING("cancel", resolution.availableServices);
        const target = resolution.booking;
        const resolved = await resolveProviderOrFail(deps, orgId);
        if ("failure" in resolved) return resolved.failure;
        const provider = resolved.provider;
        // Cancel the durable booking FIRST: the DB is the source of truth for reminders
        // (findUpcomingConfirmed) and slot availability, so a provider failure must never
        // leave a "confirmed" row that fires a reminder for a deleted event. Deleting a
        // calendar event is not reversible, so it runs best-effort AFTER the DB cancel.
        try {
          await deps.bookingStore.cancel(orgId, target.id);
        } catch (err) {
          console.warn("[calendar-reschedule] cancel failed", err);
          return fail("CANCEL_FAILURE", "I couldn't cancel that appointment just now.", {
            retryable: false,
            modelRemediation: "Apologize and escalate so a human can cancel the appointment.",
          });
        }
        if (target.calendarEventId) {
          try {
            await provider.cancelBooking(target.calendarEventId);
          } catch (err) {
            // Booking is already cancelled in the DB (no reminder will fire); the calendar
            // event lingers until a human/cron cleans it up. Don't fail the cancel.
            console.warn(
              "[calendar-reschedule] calendar event delete failed (booking already cancelled in DB)",
              err,
            );
          }
        }
        getMetrics().bookingCancel.inc({ orgId });
        return ok({ bookingId: target.id, status: "cancelled", service: target.service });
      },
    },
  };
}
