import type { LeadIntake, LeadIntakeOutcome } from "@switchboard/schemas";
import { normalizeToE164 } from "@switchboard/schemas";
import { normalizeEmail } from "../identity/normalize.js";
import { decideContactMatch } from "./match-contact-identity.js";

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
    email?: string | null;
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
  /** True ONLY for an idempotency hit (same idempotencyKey redelivered). A4 reuse is NOT a duplicate. */
  duplicate: boolean;
  /**
   * The disposition of this intake. The Meta-lead orchestrator greets + records an inquiry ONLY when
   * this is `"created"`; `"reused"` (an A4 identity match into an existing Contact) and
   * `"idempotent_duplicate"` both suppress the first-touch greeting so one corroborated person is
   * greeted exactly once.
   */
  outcome: LeadIntakeOutcome;
}

export class LeadIntakeHandler {
  constructor(private readonly deps: LeadIntakeHandlerDeps) {}

  async handle(intake: LeadIntake): Promise<LeadIntakeResult> {
    const existing = await this.deps.store.findContactByIdempotency(
      intake.organizationId,
      intake.idempotencyKey,
    );
    if (existing) {
      return { contactId: existing.id, duplicate: true, outcome: "idempotent_duplicate" };
    }

    // A4 identity matcher: look up existing contacts by normalized phone OR email BEFORE creating, so a
    // same person arriving via two ad paths (CTWA + Instant Form) collapses to one Contact. Reuse only
    // on a corroborated single match; flag (separate record, never merge) on ambiguity/conflict.
    const phoneE164 = normalizeToE164(intake.contact.phone ?? null);
    const email = intake.contact.email ? normalizeEmail(intake.contact.email) : null;
    const candidates =
      phoneE164 || email
        ? await this.deps.store.findByPhoneOrEmail({
            organizationId: intake.organizationId,
            phoneE164,
            email,
          })
        : [];
    const decision = decideContactMatch(
      { phoneE164, email, name: intake.contact.name ?? null },
      candidates,
    );

    let contactId: string;
    if (decision.kind === "reuse") {
      // Reuse preserves the matched contact untouched. Lead intake only ever carries an opt-in or
      // neutral signal (never a restriction), so the most-restrictive consolidation of {existing,
      // incoming} is always the existing state — writing nothing is what guarantees consent is never
      // widened on reuse (D1).
      contactId = decision.contactId;
    } else {
      // P1-5: only an Instant Form submission is a DURABLE WhatsApp messaging opt-in (the ad form
      // carries the WhatsApp opt-in checkbox). A click-to-WhatsApp ad-click is NOT a permanent opt-in:
      // a genuine CTWA lead arrives as a real WhatsApp inbound and rides the 24h lastWhatsAppInboundAt
      // free-entry-point window instead, so it is greetable in-window and blocks no_optin afterwards
      // (canSendWhatsAppTemplate). Email/SMS leads never opt in here.
      const isWhatsAppLead = intake.contact.channel === "whatsapp";
      const optInSource = isWhatsAppLead && intake.source === "instant_form" ? "web_form" : null;
      const contact = await this.deps.store.upsertContact({
        organizationId: intake.organizationId,
        deploymentId: intake.deploymentId,
        phone: intake.contact.phone,
        email, // normalized (lowercased) at write so the email-index lookup is canonical
        name: intake.contact.name ?? null,
        channel: intake.contact.channel,
        sourceType: intake.source,
        sourceAdId: intake.attribution.sourceAdId,
        sourceCampaignId: intake.attribution.sourceCampaignId,
        sourceAdsetId: intake.attribution.sourceAdsetId,
        attribution: intake.attribution,
        idempotencyKey: intake.idempotencyKey,
        duplicateContactRisk: decision.kind === "create_flagged",
        ...(optInSource ? { messagingOptIn: true, messagingOptInSource: optInSource } : {}),
      });
      contactId = contact.id;
    }

    await this.deps.store.createActivity({
      contactId,
      organizationId: intake.organizationId,
      deploymentId: intake.deploymentId,
      kind: "lead_received",
      sourceType: intake.source,
      metadata: { attribution: intake.attribution },
    });
    return {
      contactId,
      duplicate: false,
      outcome: decision.kind === "reuse" ? "reused" : "created",
    };
  }
}
