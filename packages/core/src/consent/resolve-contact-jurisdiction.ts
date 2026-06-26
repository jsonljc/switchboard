import { jurisdictionFromE164, type PdpaJurisdiction } from "@switchboard/schemas";

/**
 * The single chokepoint for a contact's PDPA jurisdiction, resolved in precedence
 * order:
 *   1. the stamped `pdpaJurisdiction` — immutable once set, so it ALWAYS wins. This
 *      guarantees a contact resolves the same way on every governed turn and never
 *      triggers a spurious `ConsentJurisdictionMismatch` on re-stamp.
 *   2. else the country code of the contact's E.164 phone (`+65 -> SG`, `+60 -> MY`)
 *      — the lawful basis for a brand-new lead who has no stamp yet.
 *   3. else the org's market default (`governanceConfig.jurisdiction`).
 *
 * Always returns a concrete jurisdiction (never null) because `orgDefault` is
 * required, so the stamp site can stamp the result unconditionally.
 *
 * This governs only the contact-DATA surfaces (PDPA consent + disclosure). The
 * output-claim gates (banned-phrase / claim / price) stay governed by the clinic's
 * own market and must NOT call this.
 */
export function resolveContactJurisdiction(
  contact: { pdpaJurisdiction?: PdpaJurisdiction | null; phoneE164?: string | null },
  orgDefault: PdpaJurisdiction,
): PdpaJurisdiction {
  return contact.pdpaJurisdiction ?? jurisdictionFromE164(contact.phoneE164) ?? orgDefault;
}
