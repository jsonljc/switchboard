import type { SkillTool, SkillRequestContext } from "../types.js";
import type { ToolResult } from "../tool-result.js";
import { ok, fail } from "../tool-result.js";
import { getMetrics } from "../../telemetry/metrics.js";
import {
  SlotQuerySchema,
  STAGES_AT_OR_BEYOND_BOOKED,
  isBookingSlotConflictError,
} from "@switchboard/schemas";
import type { CalendarProvider } from "@switchboard/schemas";
import { enforceConsentPrecondition } from "./calendar-book-consent.js";
import { parseSlotWindowOrFail } from "./slot-window.js";
import { buildBookedConversionPayload } from "./booked-conversion-payload.js";
import { resolveBookedValueForBooking } from "./booking-value.js";
import { buildRescheduleOperations } from "./calendar-reschedule.js";
import { buildCalendarReceiptData } from "../../receipts/mint-calendar-receipt.js";
import {
  isPrismaUniqueConstraintError,
  issueReceiptedBookingInTx,
} from "./issue-receipted-booking.js";
import type { CalendarBookToolDeps, CalendarProviderFactory } from "./calendar-book-types.js";
// Re-export the public tool types so existing import sites keep resolving them from
// calendar-book.js after the type split (skill-runtime/tools/index.ts, tests).
export type { CalendarBookToolDeps, CalendarProviderFactory };

const NOT_CONFIGURED_REMEDIATION =
  "Do not tell the customer there are no available slots. Escalate to the operator because calendar booking is not configured.";

export async function resolveProviderOrFail(
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
 * Exported per-operation input-schema constants — the single source of truth for
 * each operation's LLM-facing input contract. The factory references these by
 * value (behaviour-preserving); the alex-conversation eval imports them so its
 * mock tools present the EXACT production contract (EV-5/AGENT-5 mock-tool-blind
 * gap). `booking.create` accepts NO contactId / attendee fields — contactId is
 * sourced from the trusted SkillRequestContext, never from LLM tool input (AI-1),
 * and the attendee name/email are read from the contact record, not the model.
 */
export const CALENDAR_BOOK_SLOTS_QUERY_INPUT_SCHEMA: Record<string, unknown> = Object.freeze({
  type: "object",
  properties: {
    dateFrom: { type: "string", description: "ISO 8601 start date" },
    dateTo: { type: "string", description: "ISO 8601 end date" },
    durationMinutes: { type: "number", description: "Appointment duration in minutes" },
    service: { type: "string", description: "Service type" },
    timezone: { type: "string", description: "IANA timezone" },
  },
  required: ["dateFrom", "dateTo", "durationMinutes", "service", "timezone"],
});

export const CALENDAR_BOOK_BOOKING_CREATE_INPUT_SCHEMA: Record<string, unknown> = Object.freeze({
  type: "object",
  properties: {
    service: { type: "string" },
    slotStart: { type: "string", description: "ISO 8601" },
    slotEnd: { type: "string", description: "ISO 8601" },
    calendarId: { type: "string" },
  },
  required: ["service", "slotStart", "slotEnd", "calendarId"],
});

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
        inputSchema: CALENDAR_BOOK_SLOTS_QUERY_INPUT_SCHEMA,
        execute: async (params: unknown) => {
          // safeParse (not parse): SlotQuerySchema is stricter than the coarse
          // runtime input guard (int/positive/min-length), so malformed LLM input
          // must degrade to a recoverable tool failure, not throw and kill the turn.
          const parsed = SlotQuerySchema.safeParse(params);
          if (!parsed.success) {
            return fail("INVALID_SLOT_QUERY", "The slot query parameters were invalid.", {
              retryable: true,
              modelRemediation:
                "Re-issue slots.query with a positive integer durationMinutes and a non-empty service.",
            });
          }
          const query = parsed.data;
          const resolved = await resolveProviderOrFail(deps, ctx.orgId);
          if ("failure" in resolved) return resolved.failure;
          const slots = await resolved.provider.listAvailableSlots(query);
          if (slots.length === 0) {
            getMetrics().slotQueryZeroResult.inc({ orgId: ctx.orgId, service: query.service });
            // An empty result is a SUCCESSFUL query, not a tool failure. Return structured
            // guidance (reinjected to the model) so Alex offers a WIDER window instead of
            // telling the lead the system is broken or handing off — the after-hours bug.
            return ok({ slots } as Record<string, unknown>, {
              nextActions: [
                "No open slots in that window. This is NOT an error and NOT a reason to " +
                  "escalate. Offer the lead a wider date range or a different time of day " +
                  "(e.g. later in the week, or earlier/later in the day), then call " +
                  "calendar-book.slots.query again. Do not tell the lead the system is down.",
              ],
            });
          }
          return ok({ slots } as Record<string, unknown>);
        },
      },
      "booking.create": {
        description:
          "Book a calendar slot for a contact. Persists booking, creates calendar event, emits booked event via outbox.",
        effectCategory: "external_mutation" as const,
        // Booking a consult is Alex's core, reversible revenue action. A freshly
        // onboarded real org resolves to "supervised" trust (ensureAlexListingForOrg
        // seeds trustScore:0, no trustLevelOverride), and the canonical real-org
        // path becomes "guided" only once trust is earned. At BOTH levels an
        // external_mutation would otherwise require approval, which the in-skill
        // governance hook cannot park: it dead-ends (the booking never persists and
        // the customer is falsely told a team member will confirm). Auto-approve the
        // BOOKING intent at supervised AND guided so Alex can complete the DEFAULT
        // real-org booking. This override is scoped to booking.create ONLY — it is
        // NOT a blanket external_mutation relaxation (reschedule/cancel carry their
        // own narrower overrides). The alternative posture (operator-park each
        // booking for a human to confirm) is the deferred F2 work.
        governanceOverride: {
          supervised: "auto-approve" as const,
          guided: "auto-approve" as const,
        },
        idempotent: true,
        inputSchema: CALENDAR_BOOK_BOOKING_CREATE_INPUT_SCHEMA,
        execute: async (params: unknown): Promise<ToolResult> => {
          const input = params as {
            service: string;
            slotStart: string;
            slotEnd: string;
            calendarId: string;
          };

          const orgId = ctx.orgId;
          const contactId = ctx.contactId;
          if (!contactId) {
            return fail("MISSING_CONTACT", "No contact is associated with this conversation.", {
              modelRemediation:
                "Do not call booking.create without an active contact. Escalate to the operator.",
              retryable: false,
            });
          }

          // P2-2: validate the LLM-supplied slot window BEFORE the consent read,
          // the opportunity resolve, and the durable write. An unparseable date
          // would otherwise reach `new Date(...)` -> Invalid Date and throw at the
          // Prisma booking write (or at .toISOString()), killing the whole turn.
          // A recoverable, retryable fail lets Alex re-offer a valid slot instead.
          const parsedWindow = parseSlotWindowOrFail(input.slotStart, input.slotEnd);
          if ("failure" in parsedWindow) return parsedWindow.failure;

          // F15 — flag-gated consent precondition (INERT BY DEFAULT). Runs AFTER
          // contactId is resolved and BEFORE any write (no opportunity, no
          // booking). Absent dep => legacy behavior (no read, no block). Mode
          // "off" => not even a consent read, so zero overhead and zero behavior
          // change for every org that has not opted in.
          if (deps.consentPrecondition) {
            const consentResult = await enforceConsentPrecondition(deps.consentPrecondition, {
              deploymentId: ctx.deploymentId,
              orgId,
              contactId,
            });
            if (consentResult) return consentResult;
          }

          const contactRecord = await deps.contactStore.findById(orgId, contactId);
          const attendeeName = contactRecord?.name ?? null;
          const attendeeEmail = contactRecord?.email ?? null;

          const resolved = await resolveProviderOrFail(deps, orgId);
          if ("failure" in resolved) return resolved.failure;
          const provider = resolved.provider;

          // D3-1: value the booked service from the org playbook (cents), abstaining to
          // null when there is no playbook / no exact id-or-name match / unpriced / the
          // read fails. Resolved BEFORE the opp branch so the freshly-booked service's
          // price is preferred over a stale placeholder estimate (Alex's general-inquiry
          // opp is typically unpriced).
          const bookedValueCents = await resolveBookedValueForBooking(
            deps.getServicesForOrg,
            input.service,
            orgId,
          );

          // Resolve the clinic's currency from its market HERE, before the external
          // calendar mutation below, so a resolver failure can never orphan a live
          // calendar event. A null (unresolvable market) abstains the currency stamp
          // at confirm time; it never blocks the booking, mirroring the value-abstain
          // on an unpriced service. Currency is market-derived, independent of price.
          const currency = await deps.resolveCurrency(ctx.deploymentId);

          // Resolve or create opportunity
          let opportunityId: string | null = null;
          let estimatedValue: number | null = null;
          const existing = await deps.opportunityStore.findActiveByContact(orgId, contactId);
          if (existing) {
            opportunityId = existing.id;
            // Prefer the freshly-resolved booked-service value; fall back to the opp's
            // stored estimate only when the booked service is unpriced (abstained).
            estimatedValue = bookedValueCents ?? existing.estimatedValue ?? null;
          } else {
            const created = await deps.opportunityStore.create({
              organizationId: orgId,
              contactId,
              service: input.service,
            });
            opportunityId = created.id;
            estimatedValue = bookedValueCents;
          }

          // 1. Persist booking as pending (with duplicate guard)
          let booking: { id: string };
          try {
            booking = await deps.bookingStore.create({
              organizationId: orgId,
              contactId,
              opportunityId,
              service: input.service,
              startsAt: new Date(input.slotStart),
              endsAt: new Date(input.slotEnd),
              attendeeName,
              attendeeEmail,
              workTraceId: ctx.workUnitId ?? null,
            });
          } catch (err) {
            // Concurrent booking won the overlap race (store guard). Recoverable:
            // re-offer the next slots instead of falsely claiming it's booked.
            if (isBookingSlotConflictError(err)) {
              getMetrics().bookingSlotConflict.inc({ orgId });
              return fail("SLOT_TAKEN", "That time was just taken.", {
                retryable: true,
                data: { failureType: "slot_conflict" },
                modelRemediation:
                  "Re-run calendar-book.slots.query and offer the lead the next available times. Do not claim the slot is booked.",
              });
            }
            if (isPrismaUniqueConstraintError(err)) {
              const existingBooking = await deps.bookingStore.findBySlot(
                orgId,
                contactId,
                input.service,
                new Date(input.slotStart),
              );
              getMetrics().bookingFailed.inc({ orgId, reason: "duplicate" });
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
              contactId,
              organizationId: orgId,
              opportunityId,
              slot: {
                start: input.slotStart,
                end: input.slotEnd,
                calendarId: input.calendarId,
                available: true,
              },
              service: input.service,
              attendeeName: attendeeName ?? undefined,
              attendeeEmail: attendeeEmail ?? undefined,
              createdByType: "agent" as const,
            });
          } catch (error) {
            const failResult = await deps.failureHandler.handle({
              bookingId: booking.id,
              orgId,
              contactId,
              service: input.service,
              provider: "google_calendar",
              error,
              failureType: "provider_error",
              retryable: false,
            });
            getMetrics().bookingFailed.inc({ orgId, reason: "provider_error" });
            return fail("BOOKING_FAILURE", failResult.message, {
              data: failResult as unknown as Record<string, unknown>,
            });
          }

          // 3. On success: confirm booking + write outbox in one transaction.
          // `currency` was resolved above, before the external calendar mutation.
          let stageAdvanced = false;
          try {
            const eventId = `evt_booked_${booking.id}`;
            await deps.runTransaction(async (tx) => {
              // Status-guarded confirm (compare-and-set on pending_confirmation). If the
              // stalled-booking reaper (or any terminalizer) flipped this row OUT of
              // pending_confirmation while the provider call was in flight (a stall past the reaper
              // TTL), count === 0: do NOT resurrect it to confirmed. Resurrecting would re-occupy a
              // slot another lead may now hold (a double-book) and mint a phantom booked conversion.
              // Abort the tx; the catch below runs orphan-event compensation + the failure handler.
              // Mirrors the store create/reschedule CAS; also org-scopes the write (was id-only).
              // The reaper terminalizes to "failed", on which booking-failure-handler early-returns,
              // so routing an already-reaped row here does NOT double-escalate (keep that status in
              // sync if a future terminalizer uses a different one).
              const confirmed = await tx.booking.updateMany({
                where: {
                  id: booking.id,
                  organizationId: orgId,
                  status: "pending_confirmation",
                },
                data: {
                  status: "confirmed",
                  calendarEventId: calendarResult.calendarEventId,
                },
              });
              if (confirmed.count === 0) {
                throw new Error(
                  "booking is no longer pending_confirmation (terminalized during the provider call); not resurrecting to confirmed",
                );
              }
              const conversion = buildBookedConversionPayload(contactRecord);
              await tx.outboxEvent.create({
                data: {
                  eventId,
                  type: "booked",
                  status: "pending",
                  payload: {
                    type: "booked",
                    contactId,
                    organizationId: orgId,
                    value: estimatedValue ?? 0,
                    currency,
                    sourceCampaignId: conversion.sourceCampaignId,
                    sourceAdId: conversion.sourceAdId,
                    customer: conversion.customer,
                    attribution: conversion.attribution,
                    // The booked CONVERSION happened now (booking just confirmed), not at
                    // the future appointment slot. Meta CAPI's event_time (mapped from
                    // occurredAt in meta-capi-dispatcher) must be the conversion time: a
                    // future event_time is rejected by Meta and silently drops the booked
                    // conversion, losing attribution. The appointment time stays available
                    // below in metadata.slotStart for any consumer that needs it.
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
              // Mint a booked CalendarReceipt in the same durable tx so
              // the receipt is never orphaned from the booking confirmation.
              const requestedTier = deps.receiptTierForProvider(provider);
              const providerTrusted = requestedTier !== "T3_ADMIN_AUDIT";
              const receiptData = buildCalendarReceiptData({
                bookingId: booking.id,
                organizationId: orgId,
                opportunityId,
                calendarEventId: calendarResult.calendarEventId ?? null,
                providerTrusted,
                requestedTier,
                isProduction: deps.isProduction,
              });
              await tx.receipt.create({ data: receiptData as unknown as Record<string, unknown> });
              // Monotonic stage advance in the same durable tx: a confirmed
              // booking always implies a booked opp. updateMany never throws on
              // count:0 and the `notIn` guard skips an already-advanced opp, so a
              // stage no-op never fails the booking.
              if (opportunityId) {
                const adv = await tx.opportunity.updateMany({
                  where: {
                    id: opportunityId,
                    organizationId: orgId,
                    stage: { notIn: STAGES_AT_OR_BEYOND_BOOKED },
                  },
                  // D3-1: stamp the booked-service value at the booked transition,
                  // ONLY when the playbook resolved a real price. The conditional spread
                  // never writes a fabricated 0 nor wipes a prior estimate when abstaining.
                  data: {
                    stage: "booked",
                    ...(bookedValueCents !== null ? { estimatedValue: bookedValueCents } : {}),
                  },
                });
                stageAdvanced = adv.count > 0;
              }

              // Issue the derived ReceiptedBooking read-model row in the SAME durable tx (idempotent,
              // governed, never a post-submit write). The doctrine tradeoff (a read-model write inside
              // the canonical booking tx) and the infallible-by-construction mitigation live in the
              // helper. `conversion` carries the booking-time attribution evidence.
              await issueReceiptedBookingInTx(tx, {
                organizationId: orgId,
                bookingId: booking.id,
                contactId,
                sourceAdId: conversion.sourceAdId,
                sourceCampaignId: conversion.sourceCampaignId,
                estimatedValueCents: estimatedValue,
                currency,
                now: new Date(),
              });
            });
          } catch (error) {
            // Provider event created but durable confirm failed: best-effort
            // cancel the orphan so no live, untracked slot blocks the calendar.
            if (calendarResult.calendarEventId) {
              try {
                await provider.cancelBooking(calendarResult.calendarEventId);
              } catch (cancelErr) {
                console.warn("[calendar-book] orphan-event compensation failed", cancelErr);
              }
            }
            const failResult = await deps.failureHandler.handle({
              bookingId: booking.id,
              orgId,
              contactId,
              service: input.service,
              provider: "google_calendar",
              error,
              failureType: "confirmation_failed",
              retryable: true,
            });
            getMetrics().bookingFailed.inc({ orgId, reason: "confirmation_failed" });
            return fail("BOOKING_FAILURE", failResult.message, {
              data: failResult as unknown as Record<string, unknown>,
            });
          }

          getMetrics().bookingConfirmed.inc({ orgId });
          if (stageAdvanced) getMetrics().bookingStageAdvanced.inc({ orgId });

          // Post-confirm notification (best-effort). The booking is already durably confirmed; a
          // notification failure must never fail it. The local provider sends its RESEND-gated
          // email here, after the durable commit, because its cancelBooking is a no-op and a
          // pre-confirm email could not be compensated. Google notifies natively during
          // createBooking and omits this hook.
          if (provider.notifyBookingConfirmed) {
            try {
              await provider.notifyBookingConfirmed({
                bookingId: booking.id,
                attendeeEmail,
                attendeeName,
                service: input.service,
                startsAt: input.slotStart,
                endsAt: input.slotEnd,
              });
            } catch (notifyErr) {
              console.warn("[calendar-book] booking-confirmation notification failed", notifyErr);
            }
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
      ...buildRescheduleOperations(ctx, deps),
    },
  });
}
