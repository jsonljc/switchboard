import type { LeadIntake } from "@switchboard/schemas";
import type { IngressLike } from "./ctwa-adapter.js";

/**
 * Parsed Meta Instant Form lead, normalized from the Meta lead detail API
 * (`/{leadgen-id}` Graph endpoint) plus the corresponding webhook envelope.
 */
export interface InstantFormLead {
  leadgenId: string;
  adId?: string;
  adsetId?: string;
  campaignId?: string;
  formId?: string;
  organizationId: string;
  deploymentId: string;
  fieldData: Array<{ name: string; values: string[] }>;
}

const stringOrUndefined = (v: unknown): string | undefined =>
  typeof v === "string" && v ? v : undefined;

const fieldValue = (lead: InstantFormLead, name: string): string | undefined =>
  stringOrUndefined(lead.fieldData.find((f) => f.name === name)?.values[0]);

const normalizePhone = (raw: string | undefined): string | undefined => {
  if (!raw) return undefined;
  return raw.startsWith("+") ? raw : `+${raw}`;
};

/**
 * Pure builder: maps a Meta Instant Form lead into a `LeadIntake` payload,
 * or returns `null` when the lead has neither an email nor a phone (the
 * `LeadIntake` schema requires at least one). Such leads cannot be ingested
 * as Contacts and should be surfaced to the operator separately.
 */
export function buildInstantFormIntake(
  lead: InstantFormLead,
  opts: { now: () => Date },
): LeadIntake | null {
  const email = fieldValue(lead, "email");
  const phone = normalizePhone(fieldValue(lead, "phone_number"));
  const name = fieldValue(lead, "full_name");

  if (!email && !phone) return null;

  return {
    source: "instant_form",
    organizationId: lead.organizationId,
    deploymentId: lead.deploymentId,
    contact: {
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
      ...(name ? { name } : {}),
    },
    attribution: {
      leadgen_id: lead.leadgenId,
      ...(lead.adId ? { sourceAdId: lead.adId } : {}),
      ...(lead.adsetId ? { sourceAdsetId: lead.adsetId } : {}),
      ...(lead.campaignId ? { sourceCampaignId: lead.campaignId } : {}),
      capturedAt: opts.now().toISOString(),
      raw: { formId: lead.formId, fieldData: lead.fieldData },
    },
    idempotencyKey: `leadgen:${lead.leadgenId}`,
  };
}

export interface InstantFormAdapterDeps {
  ingress: IngressLike;
  now: () => Date;
}

/**
 * Result of a successful `lead.intake` submission. Mirrors
 * `LeadIntakeHandler.LeadIntakeResult` so callers (e.g. the meta.lead.intake
 * orchestrator workflow) can spawn child work units against the resolved
 * Contact and short-circuit on duplicates.
 */
export interface InstantFormIngestResult {
  contactId: string;
  duplicate: boolean;
}

/**
 * Adapter that converts Meta Instant Form leads into `lead.intake`
 * submissions through `PlatformIngress`. Leads missing both email and phone
 * are silently skipped (no Contact can be created without a primary identifier);
 * in that case `ingest` returns `null`.
 */
export class InstantFormAdapter {
  constructor(private readonly deps: InstantFormAdapterDeps) {}

  async ingest(lead: InstantFormLead): Promise<InstantFormIngestResult | null> {
    const intake = buildInstantFormIntake(lead, { now: this.deps.now });
    if (!intake) return null;
    const response = await this.deps.ingress.submit({
      intent: "lead.intake",
      payload: intake,
      idempotencyKey: intake.idempotencyKey,
    });
    const outputs = (response.result as { outputs?: Record<string, unknown> } | undefined)?.outputs;
    const contactId = typeof outputs?.["contactId"] === "string" ? outputs["contactId"] : undefined;
    const duplicate = outputs?.["duplicate"] === true;
    if (!contactId) return null;
    return { contactId, duplicate };
  }
}
