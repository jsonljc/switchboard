import type { AttributionChain } from "@switchboard/schemas";

/**
 * The attribution/identity surface stamped onto a `booked` outbox event.
 *
 * INVARIANT: a booked event preserves customer match keys and source
 * attribution exactly as known at booking time; known-but-missing fields are
 * explicit `null`, never inferred.
 */
export interface BookedConversionPayload {
  sourceCampaignId: string | null;
  sourceAdId: string | null;
  customer: { email: string | null; phone: string | null };
  attribution: { fbclid: string | null; lead_id: string | null };
}

/**
 * Maps a contact's persisted columns + AttributionChain onto the booked-event
 * surface. `customer` derives from contact columns and is INDEPENDENT of
 * attribution — an organic contact with an email still carries it. Encodes the
 * one schema/history quirk: ConversionEvent `attribution.lead_id` comes from
 * AttributionChain `leadgen_id`. `sourceAdSetId` is intentionally omitted (not
 * in the persisted schema; no in-scope consumer).
 */
export function buildBookedConversionPayload(
  contact: {
    email?: string | null;
    phone?: string | null;
    attribution?: AttributionChain | null;
  } | null,
): BookedConversionPayload {
  const attribution = contact?.attribution ?? null;
  return {
    sourceCampaignId: attribution?.sourceCampaignId ?? null,
    sourceAdId: attribution?.sourceAdId ?? null,
    customer: {
      email: contact?.email ?? null,
      phone: contact?.phone ?? null,
    },
    attribution: {
      fbclid: attribution?.fbclid ?? null,
      lead_id: attribution?.leadgen_id ?? null,
    },
  };
}
