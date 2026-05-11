import type { ContactConsentState } from "@switchboard/schemas";
import { ContactNotFound } from "./errors.js";

/**
 * Read-side view of a Contact's consent state. The runtime hook and admin
 * endpoint consume this; never imports Prisma directly (Layer 3 rule).
 */
export interface ContactConsentReader {
  /** Throws ContactNotFound if no row exists. */
  read(contactId: string): Promise<ContactConsentState>;
}

export { ContactNotFound };
