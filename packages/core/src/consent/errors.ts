import type { PdpaJurisdiction } from "@switchboard/schemas";

export class ConsentJurisdictionMismatch extends Error {
  readonly contactId: string;
  readonly stamped: PdpaJurisdiction;
  readonly provided: PdpaJurisdiction;
  constructor(input: { contactId: string; stamped: PdpaJurisdiction; provided: PdpaJurisdiction }) {
    super(
      `Consent jurisdiction mismatch on contact ${input.contactId}: stamped=${input.stamped}, provided=${input.provided}`,
    );
    this.name = "ConsentJurisdictionMismatch";
    this.contactId = input.contactId;
    this.stamped = input.stamped;
    this.provided = input.provided;
  }
}

export class ConsentRevokedCannotRegrant extends Error {
  readonly contactId: string;
  readonly revokedAt: Date;
  constructor(input: { contactId: string; revokedAt: Date }) {
    super(
      `Contact ${input.contactId} has revoked consent at ${input.revokedAt.toISOString()}; use clearConsent to start a fresh cycle.`,
    );
    this.name = "ConsentRevokedCannotRegrant";
    this.contactId = input.contactId;
    this.revokedAt = input.revokedAt;
  }
}

export class ContactNotFound extends Error {
  readonly contactId: string;
  constructor(input: { contactId: string }) {
    super(`Contact not found: ${input.contactId}`);
    this.name = "ContactNotFound";
    this.contactId = input.contactId;
  }
}

/**
 * Thrown by `ConsentService.clearConsent` when notes are empty. The audit
 * trail requires a non-empty justification — the admin route's Zod schema
 * also enforces this, but the service guard catches direct skill-runtime
 * callers that bypass the Zod boundary.
 */
export class ConsentNotesRequired extends Error {
  constructor(message = "clearConsent requires non-empty notes (audit trail)") {
    super(message);
    this.name = "ConsentNotesRequired";
  }
}

/**
 * Thrown by `ConsentService.clearConsent` when the caller's actor identifier
 * starts with the `system:` prefix. `clearConsent` is operator-initiated and
 * must be attributable to a real user ID for compliance review.
 */
export class ConsentSystemActorRejected extends Error {
  readonly actor: string;
  constructor(input: { actor: string }) {
    super(`clearConsent rejects system: actors; require a real userId (got ${input.actor})`);
    this.name = "ConsentSystemActorRejected";
    this.actor = input.actor;
  }
}
