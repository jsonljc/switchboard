import type { AttributionConfidence } from "@switchboard/schemas";

/**
 * Source evidence for a booking, gathered from ConversionRecord (by bookingId) + Contact.
 * All fields optional/nullable — absence is the unattributed case.
 */
export interface AttributionEvidence {
  /** Meta lead-form id (Contact.leadgenId) — a hard lead identifier. */
  leadgenId?: string | null;
  /** ConversionRecord.sourceAdId — a hard ad identifier. */
  sourceAdId?: string | null;
  /** ConversionRecord.sourceCampaignId / Contact campaign. */
  sourceCampaignId?: string | null;
  /** Contact.sourceType (ctwa | instant_form | organic | web | ...). */
  sourceType?: string | null;
  /** ConversionRecord.sourceChannel / Contact.firstTouchChannel. */
  sourceChannel?: string | null;
}

/** First-party lead sources that, with a campaign id, earn "high" confidence. */
const FIRST_PARTY_SOURCE_TYPES = new Set(["ctwa", "instant_form"]);

/**
 * Map source evidence to an attribution-confidence rung (revenue-proof direction, Ledger spec).
 * Pure enum mapping by precedence — no numeric thresholds (so no NaN-blind comparison gate).
 * "unattributed" still counts as a receipted booking; it raises a missing_source exception.
 */
export function scoreAttribution(evidence: AttributionEvidence): AttributionConfidence {
  if (evidence.leadgenId || evidence.sourceAdId) return "deterministic";
  if (
    evidence.sourceCampaignId &&
    evidence.sourceType &&
    FIRST_PARTY_SOURCE_TYPES.has(evidence.sourceType)
  ) {
    return "high";
  }
  if (evidence.sourceCampaignId || evidence.sourceChannel) return "medium";
  if (evidence.sourceType) return "low";
  return "unattributed";
}
