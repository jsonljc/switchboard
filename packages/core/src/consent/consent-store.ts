import type { ContactConsentState, PdpaJurisdiction, ConsentSource } from "@switchboard/schemas";

/**
 * Narrow seam for ConsentService mutations. Implemented in @switchboard/db.
 * No business logic lives here — the service composes this store with the
 * verdict store + conversation status setter + handoff store to enforce
 * invariants and emit audit rows.
 */
export interface ConsentStateStore {
  /** Read current state without throwing on missing — returns null. */
  readOrNull(contactId: string): Promise<ContactConsentState | null>;

  /** Set pdpaJurisdiction only if currently null. No-op if already stamped to
   *  the same value. Throws if stamped to a different value (caller wraps). */
  setJurisdictionIfNull(contactId: string, jurisdiction: PdpaJurisdiction): Promise<void>;

  /** Atomic disclosure-fields update. Does not touch consent timestamps. */
  setDisclosure(input: {
    contactId: string;
    version: string;
    shownAt: Date;
    actor: string;
  }): Promise<void>;

  /** Atomic grant update. Caller has already verified revokedAt is null. */
  setGrant(input: {
    contactId: string;
    grantedAt: Date;
    source: ConsentSource;
    actor: string;
    notes?: string;
  }): Promise<void>;

  /** Atomic revocation update. Idempotent at the SQL level: only sets
   *  consentRevokedAt if currently null (use a conditional WHERE clause). */
  setRevocationIfNotRevoked(input: {
    contactId: string;
    revokedAt: Date;
    source: ConsentSource;
    actor: string;
    notes?: string;
  }): Promise<{ wasNewlyRevoked: boolean; existingRevokedAt: Date | null }>;

  /** Clear both consent timestamps. Preserves jurisdiction + disclosure fields. */
  clearConsentTimestamps(input: {
    contactId: string;
    actor: string;
    notes: string;
  }): Promise<{ previousGrantedAt: Date | null; previousRevokedAt: Date | null }>;
}
