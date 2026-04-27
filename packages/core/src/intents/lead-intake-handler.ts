import type { LeadIntake } from "@switchboard/schemas";

export interface LeadIntakeStore {
  findContactByIdempotency(key: string): Promise<{ id: string } | null>;
  /**
   * MUST be atomic/upsert on `idempotencyKey` to close the TOCTOU window between
   * `findContactByIdempotency` and this call. Implementations should back this
   * with a unique constraint on `(organizationId, idempotencyKey)` at the DB layer.
   */
  upsertContact(input: {
    organizationId: string;
    deploymentId: string;
    phone?: string;
    email?: string;
    channel?: string;
    sourceType: string;
    sourceAdId?: string;
    sourceCampaignId?: string;
    sourceAdsetId?: string;
    attribution: Record<string, unknown>;
    idempotencyKey: string;
  }): Promise<{ id: string }>;
  createActivity(input: {
    contactId: string;
    organizationId: string;
    deploymentId: string;
    kind: "lead_received";
    sourceType: string;
    metadata: Record<string, unknown>;
  }): Promise<{ id: string }>;
}

export interface LeadIntakeHandlerDeps {
  store: LeadIntakeStore;
}

export interface LeadIntakeResult {
  contactId: string;
  duplicate: boolean;
}

export class LeadIntakeHandler {
  constructor(private readonly deps: LeadIntakeHandlerDeps) {}

  async handle(intake: LeadIntake): Promise<LeadIntakeResult> {
    const existing = await this.deps.store.findContactByIdempotency(intake.idempotencyKey);
    if (existing) {
      return { contactId: existing.id, duplicate: true };
    }
    const contact = await this.deps.store.upsertContact({
      organizationId: intake.organizationId,
      deploymentId: intake.deploymentId,
      phone: intake.contact.phone,
      email: intake.contact.email,
      channel: intake.contact.channel,
      sourceType: intake.source,
      sourceAdId: intake.attribution.sourceAdId,
      sourceCampaignId: intake.attribution.sourceCampaignId,
      sourceAdsetId: intake.attribution.sourceAdsetId,
      attribution: intake.attribution,
      idempotencyKey: intake.idempotencyKey,
    });
    await this.deps.store.createActivity({
      contactId: contact.id,
      organizationId: intake.organizationId,
      deploymentId: intake.deploymentId,
      kind: "lead_received",
      sourceType: intake.source,
      metadata: { attribution: intake.attribution },
    });
    return { contactId: contact.id, duplicate: false };
  }
}
