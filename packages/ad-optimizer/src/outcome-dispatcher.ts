// NOTE: This dispatcher is implemented but currently DORMANT in production. See
// `apps/api/src/bootstrap/outcome-wiring.ts` for the migration plan.
import { createHash } from "node:crypto";
import type { ActionSource } from "@switchboard/schemas";
import { z } from "zod";

export const OutcomeKindSchema = z.enum(["qualified", "booked", "showed", "paid"]);

export type OutcomeKind = z.infer<typeof OutcomeKindSchema>;

export interface OutcomeEvent {
  contactId: string;
  kind: OutcomeKind;
  /**
   * Original event time. Used to synthesize a stable CAPI `event_id` when one isn't supplied
   * — required so Inngest retries dedupe at Meta instead of multiplying conversions. Callers
   * MUST pass the original occurrence time, not `new Date()` at dispatch.
   */
  occurredAt: Date;
  /**
   * Optional caller-supplied stable event id. Forwarded directly to Meta CAPI as `event_id`.
   * If absent, synthesized from (contactId, kind, bookingId, occurredAt).
   */
  eventId?: string;
  /**
   * Optional disambiguator for re-bookings by the same contact (e.g., contact rebooks after
   * a no-show). Only affects the synthesized event id; ignored when `eventId` is provided.
   */
  bookingId?: string;
  value?: number;
  currency?: string;
}

interface ContactRecord {
  id: string;
  organizationId: string;
  sourceType: string | null;
  attribution: Record<string, unknown> | null;
}

export interface ContactReader {
  getContact(id: string): Promise<ContactRecord | null>;
}

export interface CapiLike {
  dispatch(event: {
    /** Stable identifier for Meta's CAPI dedup. Same id on retry => deduplicated. */
    eventId: string;
    eventName: string;
    actionSource: ActionSource;
    attribution: Record<string, unknown>;
    value?: number;
    currency?: string;
  }): Promise<{ ok: boolean }>;
}

const KIND_TO_EVENT: Record<OutcomeKind, string> = {
  qualified: "Lead",
  booked: "Schedule",
  showed: "Schedule",
  paid: "Purchase",
};

const SOURCE_TO_ACTION_SOURCE: Record<string, ActionSource> = {
  ctwa: "business_messaging",
  instant_form: "system_generated",
};

/**
 * Synthesize a deterministic event_id from (contactId, kind, bookingId, occurredAt).
 * Identical inputs across Inngest retries produce the same id, letting Meta's CAPI dedupe.
 *
 * value/currency are intentionally excluded: a paid-event correction (same logical event,
 * adjusted amount) must dedupe against the original. Adding them to the hash would break
 * that invariant. Do not "fix" this without re-reading Meta's CAPI dedup contract.
 *
 * Delimiter is ASCII Unit Separator (\x1F) — never appears in UUIDs, the four OutcomeKind
 * values, or ISO-8601 timestamps. Robust to future contactId/bookingId formats that might
 * include arbitrary printable characters.
 */
export function synthesizeOutcomeEventId(event: OutcomeEvent): string {
  const parts = [
    event.contactId,
    event.kind,
    event.bookingId ?? "",
    event.occurredAt.toISOString(),
  ].join("\x1F");
  return createHash("sha256").update(parts).digest("hex");
}

export class OutcomeDispatcher {
  constructor(private readonly deps: { capi: CapiLike; store: ContactReader }) {}

  async handle(event: OutcomeEvent): Promise<void> {
    const contact = await this.deps.store.getContact(event.contactId);
    if (!contact || !contact.sourceType) {
      console.warn(
        `OutcomeDispatcher: skipping ${event.kind} for ${event.contactId}: no sourceType`,
      );
      return;
    }
    const actionSource = SOURCE_TO_ACTION_SOURCE[contact.sourceType];
    if (!actionSource) {
      console.warn(
        `OutcomeDispatcher: skipping ${event.kind} for ${event.contactId}: source ${contact.sourceType} not v1`,
      );
      return;
    }
    const eventId = event.eventId ?? synthesizeOutcomeEventId(event);
    await this.deps.capi.dispatch({
      eventId,
      eventName: KIND_TO_EVENT[event.kind],
      actionSource,
      attribution: contact.attribution ?? {},
      value: event.value,
      currency: event.currency,
    });
  }
}
