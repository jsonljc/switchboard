import type { ContactConsentState } from "@switchboard/schemas";
import { ContactNotFound } from "./errors.js";

/**
 * A contact's consent state plus the E.164 phone the consent gate needs to
 * resolve per-lead jurisdiction (`resolveContactJurisdiction`) at the stamp site.
 *
 * `phoneE164` lives on THIS read result rather than on the shared
 * `ContactConsentState`, so the phone (PII) never reaches the consent-state
 * surfaces that read `ContactConsentState` via `ConsentStateStore.readOrNull`
 * (the send-time enforcement gate, proactive eligibility) — those stay phone-free.
 * Consumers of THIS reader that do not need the phone (e.g. the admin consent
 * response) must not propagate it onward.
 */
export type ContactConsentRead = ContactConsentState & {
  /**
   * The contact's E.164 phone (`+65...` -> SG, `+60...` -> MY via
   * `jurisdictionFromE164`). Null when the contact has no normalized phone.
   */
  phoneE164: string | null;
};

/**
 * Read-side view of a Contact's consent state. The runtime hook and admin
 * endpoint consume this; never imports Prisma directly (Layer 3 rule).
 */
export interface ContactConsentReader {
  /**
   * Reads a contact's consent state (plus phone, for per-lead jurisdiction),
   * scoped to the organization. The read MUST filter on organizationId so a
   * contact from another tenant is never returned (cross-tenant consent data is
   * PHI-adjacent). Throws ContactNotFound if no row exists for that
   * (organizationId, contactId) pair.
   */
  read(organizationId: string, contactId: string): Promise<ContactConsentRead>;
}

export { ContactNotFound };
