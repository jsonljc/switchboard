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
