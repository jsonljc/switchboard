import type { ContactConsentState } from "@switchboard/schemas";
import { ContactNotFound } from "./errors.js";

/**
 * Read-side view of a Contact's consent state. The runtime hook and admin
 * endpoint consume this; never imports Prisma directly (Layer 3 rule).
 */
export interface ContactConsentReader {
  /**
   * Reads a contact's consent state, scoped to the organization. The read MUST
   * filter on organizationId so a contact from another tenant is never returned
   * (cross-tenant consent data is PHI-adjacent). Throws ContactNotFound if no
   * row exists for that (organizationId, contactId) pair.
   */
  read(organizationId: string, contactId: string): Promise<ContactConsentState>;
}

export { ContactNotFound };
