import type { LeadIntake } from "@switchboard/schemas";

export interface LeadIntakeStore {
  findContactByIdempotency(organizationId: string, key: string): Promise<{ id: string } | null>;
  /**
   * Candidate lookup for the intake identity matcher (A4). Org-scoped; matches contacts whose
   * normalized phoneE164 equals `phoneE164` OR whose email equals `email`. Caller passes normalized
   * values (E.164 phone, lowercased email); a null branch is skipped; both null -> []. Returns up to
   * 2 rows — the matcher only branches on 0 / exactly-1 / >1, so 2 is sufficient to flag ambiguity.
   */
  findByPhoneOrEmail(input: {
    organizationId: string;
    phoneE164: string | null;
    email: string | null;
  }): Promise<
    Array<{ id: string; name: string | null; phoneE164: string | null; email: string | null }>
  >;
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
    name?: string | null;
    channel?: string;
    sourceType: string;
    sourceAdId?: string;
    sourceCampaignId?: string;
    sourceAdsetId?: string;
    attribution: Record<string, unknown>;
    idempotencyKey: string;
    messagingOptIn?: boolean;
    messagingOptInSource?: "ctwa" | "organic_inbound" | "web_form" | "manual";
    duplicateContactRisk?: boolean;
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
    const existing = await this.deps.store.findContactByIdempotency(
      intake.organizationId,
      intake.idempotencyKey,
    );
    if (existing) {
      return { contactId: existing.id, duplicate: true };
    }
    // CTWA click and Instant Form submission both serve as WhatsApp messaging
    // consent — flag opt-in for those sources when the lead lands on the
    // whatsapp channel. Email/SMS leads do not get a WhatsApp opt-in.
    const isWhatsAppLead = intake.contact.channel === "whatsapp";
    const optInSource = isWhatsAppLead
      ? intake.source === "ctwa"
        ? "ctwa"
        : intake.source === "instant_form"
          ? "web_form"
          : null
      : null;
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
      ...(optInSource ? { messagingOptIn: true, messagingOptInSource: optInSource } : {}),
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
