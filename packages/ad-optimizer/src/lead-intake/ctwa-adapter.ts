import type { LeadIntake } from "@switchboard/schemas";
import { normalizeToE164 } from "@switchboard/schemas";

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
    parentWorkUnitId?: string;
  }): Promise<{ ok: boolean; result?: unknown }>;
}

export interface CtwaAdapterDeps {
  ingress: IngressLike;
  now: () => Date;
  region?: "SG" | "MY";
  /**
   * Resolves the parent campaign id for a CTWA-sourced ad. The lead's org is
   * threaded in `ctx` so the app-layer implementation can scope the Meta
   * credential lookup to that organization — ad-optimizer is Layer 2 and must not
   * touch the DB or construct a MetaAdsClient itself. Returns `null` when the
   * campaign can't be resolved; the adapter then submits without
   * `sourceCampaignId` (non-blocking).
   */
  resolveCampaignId?: (adId: string, ctx: { organizationId: string }) => Promise<string | null>;
}

/**
 * Pure builder: maps a parsed WhatsApp message into a `LeadIntake` payload,
 * or returns `null` when the message lacks a `ctwa_clid` (i.e. not a CTWA lead).
 */
export function buildCtwaIntake(
  msg: ParsedWhatsappMessage,
  opts: { now: () => Date; region?: "SG" | "MY" },
): LeadIntake | null {
  const stringOrUndefined = (v: unknown): string | undefined =>
    typeof v === "string" && v ? v : undefined;

  const ctwaClid = stringOrUndefined(msg.metadata["ctwaClid"]);
  if (!ctwaClid) return null;

  const normalizedPhone =
    normalizeToE164(msg.from, opts.region) ??
    (msg.from.startsWith("+") ? msg.from : `+${msg.from}`);

  return {
    source: "ctwa",
    organizationId: msg.organizationId,
    deploymentId: msg.deploymentId,
    contact: { phone: normalizedPhone, channel: "whatsapp" },
    attribution: {
      ctwa_clid: ctwaClid,
      referralUrl: stringOrUndefined(msg.metadata["ctwaSourceUrl"]),
      sourceAdId: stringOrUndefined(msg.metadata["sourceAdId"]),
      capturedAt: opts.now().toISOString(),
      raw: { ...msg.metadata },
    },
    idempotencyKey: `${normalizedPhone}:${ctwaClid}`,
  };
}

/**
 * Adapter that converts CTWA-tagged inbound WhatsApp messages into
 * `lead.intake` submissions through `PlatformIngress`. Non-CTWA messages
 * are silently skipped (no error).
 */
export class CtwaAdapter {
  constructor(private readonly deps: CtwaAdapterDeps) {}

  async ingest(
    msg: ParsedWhatsappMessage,
    opts: { parentWorkUnitId?: string } = {},
  ): Promise<void> {
    const intake = buildCtwaIntake(msg, { now: this.deps.now, region: this.deps.region });
    if (!intake) return;

    if (
      intake.attribution.sourceAdId &&
      msg.metadata["adSourceType"] === "ad" &&
      this.deps.resolveCampaignId
    ) {
      try {
        const campaignId = await this.deps.resolveCampaignId(intake.attribution.sourceAdId, {
          organizationId: intake.organizationId,
        });
        if (campaignId) {
          intake.attribution.sourceCampaignId = campaignId;
        }
      } catch {
        // Non-blocking — continue without sourceCampaignId
      }
    }

    await this.deps.ingress.submit({
      intent: "lead.intake",
      payload: intake,
      idempotencyKey: intake.idempotencyKey,
      ...(opts.parentWorkUnitId ? { parentWorkUnitId: opts.parentWorkUnitId } : {}),
    });
  }
}
