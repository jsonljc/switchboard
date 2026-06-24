import type { SkillTool, SkillRequestContext } from "../types.js";
import type { ToolResult } from "../tool-result.js";
import { ok, fail } from "../tool-result.js";
import { getMetrics } from "../../telemetry/metrics.js";
import {
  SlotQuerySchema,
  STAGES_AT_OR_BEYOND_BOOKED,
  isBookingSlotConflictError,
} from "@switchboard/schemas";
import type { CalendarProvider, AttributionChain, PlaybookService } from "@switchboard/schemas";
import { enforceConsentPrecondition } from "./calendar-book-consent.js";
import type { ConsentPrecondition } from "./calendar-book-consent.js";
import type { BookingFailureHandler } from "./booking-failure-handler.js";
import { buildBookedConversionPayload } from "./booked-conversion-payload.js";
import { resolveBookedValueForBooking } from "./booking-value.js";
import { buildRescheduleOperations } from "./calendar-reschedule.js";
import { buildCalendarReceiptData } from "../../receipts/mint-calendar-receipt.js";
import {
  isPrismaUniqueConstraintError,
  issueReceiptedBookingInTx,
} from "./issue-receipted-booking.js";
import type { ReceiptTier } from "@switchboard/schemas";

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
  findUpcomingByContact(
    orgId: string,
    contactId: string,
  ): Promise<
    Array<{
      id: string;
      calendarEventId: string | null;
      service: string;
      startsAt: Date;
      endsAt: Date;
      status: string;
    }>
  >;
  reschedule(
    orgId: string,
    bookingId: string,
    slot: { startsAt: Date; endsAt: Date },
  ): Promise<unknown>;
  cancel(orgId: string, bookingId: string): Promise<unknown>;
}

interface OpportunityStoreSubset {
  findActiveByContact(
    orgId: string,
    contactId: string,
  ): Promise<{ id: string; estimatedValue?: number | null } | null>;
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
    opportunity: {
      updateMany(args: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }): Promise<{ count: number }>;
    };
    receipt: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
    receiptedBooking: {
      findFirst(args: {
        where: Record<string, unknown>;
        select?: Record<string, boolean>;
      }): Promise<{ id: string } | null>;
      create(args: { data: Record<string, unknown> }): Promise<unknown>;
    };
    contact: {
      findFirst(args: {
        where: Record<string, unknown>;
        select?: Record<string, boolean>;
      }): Promise<{
        leadgenId?: string | null;
        sourceType?: string | null;
        firstTouchChannel?: string | null;
        consentGrantedAt?: Date | null;
        consentRevokedAt?: Date | null;
      } | null>;
    };
  }) => Promise<unknown>,
) => Promise<unknown>;

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
  contactStore: {
    findById(
      orgId: string,
      contactId: string,
    ): Promise<{
      name?: string | null;
      email?: string | null;
      phone?: string | null;
      attribution?: AttributionChain | null;
    } | null>;
  };
  /** ISO-4217 default currency for booked-conversion value (cents). Temporary
   *  injected dep until per-org currency is wired. */
  defaultCurrency: string;
  /**
   * Maps a resolved CalendarProvider to the receipt tier that should be
   * minted for this booking. Injected by apps/api — core must not read
   * process.env directly.
   */
  receiptTierForProvider: (provider: CalendarProvider) => ReceiptTier;
  /**
   * Whether the app is running in production mode. Injected by apps/api —
   * core must not read process.env directly.
   */
  isProduction: boolean;
  /**
   * F15 — OPTIONAL flag-gated consent precondition. When omitted, booking
   * behaves exactly as before (no consent read, no block) — this preserves
   * every existing construction/test that does not pass it. When present, the
   * tool enforces consent BEFORE persisting iff the deployment's consent mode is
   * "enforce". Default mode "off" makes the gate fully inert.
   */
  consentPrecondition?: ConsentPrecondition;
  /**
   * D3-1: OPTIONAL per-org playbook services lookup. When provided, a booked
   * service is valued from the playbook's numeric price (major units -> cents) and
   * stamped onto Opportunity.estimatedValue + the booked-conversion value. When
   * omitted (tests / orgs without a playbook), booking behaves exactly as before:
   * the booked value abstains to null and the conversion records 0. Returns
   * undefined when the org has no playbook.
   */
  getServicesForOrg?: (orgId: string) => Promise<readonly PlaybookService[] | undefined>;
}

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
        inputSchema: {
          type: "object",
          properties: {
            service: { type: "string" },
            slotStart: { type: "string", description: "ISO 8601" },
            slotEnd: { type: "string", description: "ISO 8601" },
            calendarId: { type: "string" },
          },
          required: ["service", "slotStart", "slotEnd", "calendarId"],
        },
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

          // 3. On success: confirm booking + write outbox in one transaction
          let stageAdvanced = false;
          try {
            const eventId = `evt_booked_${booking.id}`;
            await deps.runTransaction(async (tx) => {
              await tx.booking.update({
                where: { id: booking.id },
                data: {
                  status: "confirmed",
                  calendarEventId: calendarResult.calendarEventId,
                },
              });
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
                    currency: deps.defaultCurrency,
                    sourceCampaignId: conversion.sourceCampaignId,
                    sourceAdId: conversion.sourceAdId,
                    customer: conversion.customer,
                    attribution: conversion.attribution,
                    occurredAt: new Date(input.slotStart).toISOString(),
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
                currency: deps.defaultCurrency,
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
