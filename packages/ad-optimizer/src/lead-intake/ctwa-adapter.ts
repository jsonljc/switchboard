import type { LeadIntake } from "@switchboard/schemas";

/**
 * Parsed WhatsApp inbound message shape used by the CTWA adapter.
 * Produced upstream by the WhatsApp gateway parser (Task 3), which captures
 * `ctwa_clid` (and related referral fields) into `metadata`.
 */
export interface ParsedWhatsappMessage {
  from: string;
  metadata: Record<string, unknown>;
  organizationId: string;
  deploymentId: string;
}

/**
 * Structural subset of `PlatformIngress.submit()` used by this adapter.
 *
 * NOTE: The real `PlatformIngress.submit()` accepts a `CanonicalSubmitRequest`
 * with additional required fields (actor, trigger, deployment, etc.). This
 * adapter intentionally remains decoupled from `@switchboard/core` (Layer 2
 * cannot import from core). Task 8 will adapt this narrow call shape to the
 * real `CanonicalSubmitRequest` when wiring the adapter into the WhatsApp
 * gateway in `apps/chat/`.
 */
export interface IngressLike {
  submit(req: {
    intent: string;
    payload: unknown;
    idempotencyKey: string;
  }): Promise<{ ok: boolean; result?: unknown }>;
}

export interface CtwaAdapterDeps {
  ingress: IngressLike;
  now: () => Date;
}

/**
 * Pure builder: maps a parsed WhatsApp message into a `LeadIntake` payload,
 * or returns `null` when the message lacks a `ctwa_clid` (i.e. not a CTWA lead).
 */
export function buildCtwaIntake(
  msg: ParsedWhatsappMessage,
  opts: { now: () => Date },
): LeadIntake | null {
  const ctwaClid = msg.metadata["ctwaClid"];
  if (typeof ctwaClid !== "string" || !ctwaClid) return null;

  const sourceAdId = msg.metadata["sourceAdId"];
  const referralUrl = msg.metadata["ctwaSourceUrl"];

  return {
    source: "ctwa",
    organizationId: msg.organizationId,
    deploymentId: msg.deploymentId,
    contact: { phone: msg.from, channel: "whatsapp" },
    attribution: {
      ctwa_clid: ctwaClid,
      referralUrl: typeof referralUrl === "string" ? referralUrl : undefined,
      sourceAdId: typeof sourceAdId === "string" ? sourceAdId : undefined,
      capturedAt: opts.now().toISOString(),
      raw: msg.metadata,
    },
    idempotencyKey: `${msg.from}:${ctwaClid}`,
  };
}

/**
 * Adapter that converts CTWA-tagged inbound WhatsApp messages into
 * `lead.intake` submissions through `PlatformIngress`. Non-CTWA messages
 * are silently skipped (no error).
 */
export class CtwaAdapter {
  constructor(private readonly deps: CtwaAdapterDeps) {}

  async ingest(msg: ParsedWhatsappMessage): Promise<void> {
    const intake = buildCtwaIntake(msg, { now: this.deps.now });
    if (!intake) return;
    await this.deps.ingress.submit({
      intent: "lead.intake",
      payload: intake,
      idempotencyKey: intake.idempotencyKey,
    });
  }
}
