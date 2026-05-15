//
// Booking-backed outcome attribution for ConversationCompoundingService.
// Strong attribution wins when a Booking's workTraceId appears in the
// conversation's executed-tool work-trace set. Fallback falls back to
// org + contact in the post-conversation window. Returns "none" when
// neither tier matches — pattern extraction must NOT proceed in that
// case, regardless of what summarization.outcome says.
import type { ConversationEndEvent } from "../channel-gateway/conversation-lifecycle.js";

export const ATTRIBUTION_WINDOW_MS = 24 * 60 * 60 * 1000;

export type AttributionTier = "strong" | "fallback" | "none";

export interface BookingAttribution {
  tier: AttributionTier;
  bookingId?: string;
  workTraceId?: string;
}

/**
 * Looks up bookings backing an outcome attribution from a conversation end event.
 *
 * Implementations MUST return rows ordered by `createdAt ASC` so the resolver's
 * "first row wins" semantics are deterministic regardless of DB query plan.
 */
export interface BookingAttributionStore {
  /** MUST return rows ordered by `createdAt ASC`. */
  findByWorkTraceIds(
    organizationId: string,
    workTraceIds: string[],
  ): Promise<Array<{ id: string; workTraceId: string | null }>>;
  /** MUST return rows ordered by `createdAt ASC`. */
  findInWindow(
    organizationId: string,
    contactId: string,
    startExclusive: Date,
    endInclusive: Date,
  ): Promise<Array<{ id: string }>>;
}

export async function resolveBookingAttribution(
  store: BookingAttributionStore,
  event: ConversationEndEvent,
): Promise<BookingAttribution> {
  // Tier 1: strong — match Booking.workTraceId against the conversation's
  // executed-tool work-trace ids.
  if (event.workTraceIds && event.workTraceIds.length > 0) {
    const strong = await store.findByWorkTraceIds(event.organizationId, event.workTraceIds);
    if (strong.length > 0) {
      // Deterministic pick: first row. Multiple tool-trace bookings in one
      // conversation are vanishingly rare; if it happens, the first wins.
      return {
        tier: "strong",
        bookingId: strong[0]!.id,
        workTraceId: strong[0]!.workTraceId ?? undefined,
      };
    }
  }

  // Tier 2: fallback — same org + contact, post-conversation window only
  // (pre-conversation bookings are likely caused by an earlier touchpoint
  // and would muddy attribution). Per-deployment scoping is not enforced:
  // neither Booking nor Contact carries a deploymentId column today. Adding
  // one would be a separate schema migration.
  if (event.contactId) {
    const windowEnd = new Date(event.endedAt.getTime() + ATTRIBUTION_WINDOW_MS);
    const fallback = await store.findInWindow(
      event.organizationId,
      event.contactId,
      event.endedAt,
      windowEnd,
    );
    if (fallback.length > 0) {
      return { tier: "fallback", bookingId: fallback[0]!.id };
    }
  }

  return { tier: "none" };
}
