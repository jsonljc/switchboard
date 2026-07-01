import type { AttributionConfidence, ExceptionEntry, PdpaJurisdiction } from "@switchboard/schemas";

/**
 * Inputs for the exception evaluation. `now` is passed in (pure function, no clock access).
 * Consent reads the Contact PDPA fields (consentGrantedAt / consentRevokedAt), NEVER the
 * creative-pipeline ConsentRecord (which is org-keyed and has no contact link).
 */
export interface ExceptionContext {
  attributionConfidence: AttributionConfidence;
  /**
   * Contact.pdpaJurisdiction. Null/undefined scopes this contact OUT of PDPA exceptions here: no
   * consent is required and missing_consent is NOT raised, matching the completeness report's
   * bookable denominator (scoped to pdpaJurisdiction != null) so the worklist and the rate math
   * stay in sync. This jurisdiction-first scoping intentionally DIFFERS from deriveConsentStatus,
   * which returns "revoked" for a revoked contact regardless of jurisdiction; the receipts worklist
   * deliberately does not act on a null-jurisdiction contact. Only a contact IN a PDPA jurisdiction
   * can have an actionable missing_consent.
   */
  pdpaJurisdiction?: PdpaJurisdiction | null;
  consentGrantedAt?: Date | null;
  consentRevokedAt?: Date | null;
  /** Set when a human has overridden attribution/status (ReceiptedBooking.overriddenBy). */
  overriddenBy?: string | null;
  /** True when the contact matches another by phone/email (identity ambiguity). */
  duplicateContactRisk?: boolean;
  now: Date;
}

/**
 * Derive the current exception set for a receipted booking. Pure; the caller persists / merges.
 * Each entry is freshly raised at `now` (re-evaluation merge against prior entries is the
 * persistence layer's job, per the spec — this function only computes the current desired set).
 */
export function evaluateExceptions(ctx: ExceptionContext): ExceptionEntry[] {
  const entries: ExceptionEntry[] = [];
  if (ctx.attributionConfidence === "unattributed") {
    entries.push({ code: "missing_source", raisedAt: ctx.now });
  }
  // Only a contact in a PDPA jurisdiction can require consent; a null jurisdiction is not_applicable
  // and an absent/revoked consent there is NOT an actionable exception (would pollute the worklist).
  if (ctx.pdpaJurisdiction && (!ctx.consentGrantedAt || ctx.consentRevokedAt)) {
    entries.push({ code: "missing_consent", raisedAt: ctx.now });
  }
  if (ctx.overriddenBy) {
    entries.push({ code: "manual_override", raisedAt: ctx.now });
  }
  if (ctx.duplicateContactRisk) {
    entries.push({ code: "duplicate_contact_risk", raisedAt: ctx.now });
  }
  return entries;
}
