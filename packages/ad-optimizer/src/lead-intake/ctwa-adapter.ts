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
/**
 * The reason an ingress submission failed, threaded from the app-layer shim that
 * adapts the real `PlatformIngress.submit()` to this Layer-2 contract. The shim
 * maps `SubmitWorkResponse.error` (an `IngressError`) onto these plain fields so
 * the adapter can surface *why* a CTWA lead was dropped without importing core.
 */
export interface IngressSubmitError {
  type?: string;
  message?: string;
}

export interface IngressLike {
  submit(req: {
    intent: string;
    payload: unknown;
    idempotencyKey: string;
    parentWorkUnitId?: string;
  }): Promise<{ ok: boolean; result?: unknown; error?: IngressSubmitError }>;
}

/** Which leg of a CTWA lead.intake failed (P2-4). */
export type CtwaIngestFailureReason = "ingress_rejected" | "execution_failed";

export interface CtwaIngestFailureDetail {
  /** The `IngressError.type` for an `ingress_rejected` leg (e.g. `entitlement_required`). */
  type?: string;
  message?: string;
  /** The execution `outcome` for an `execution_failed` leg (always `"failed"`). */
  outcome?: string;
}

/**
 * Thrown by `CtwaAdapter.ingest` when a CTWA lead.intake did NOT create a Contact,
 * so the route's fire-and-forget `.catch` can SURFACE it (log + metric) instead of
 * the dropped paid lead vanishing silently (P2-4). Two legs:
 *  - `ingress_rejected`: `PlatformIngress` returned `ok:false` — an infra /
 *    entitlement / validation rejection BEFORE execution.
 *  - `execution_failed`: ingress accepted the work (`ok:true`) but the execution
 *    `outcome` was `"failed"`.
 */
export class CtwaIngestError extends Error {
  readonly reason: CtwaIngestFailureReason;
  readonly detail: CtwaIngestFailureDetail;

  constructor(reason: CtwaIngestFailureReason, detail: CtwaIngestFailureDetail = {}) {
    super(
      `CTWA lead.intake ${reason}: ${detail.type ?? detail.outcome ?? detail.message ?? "unknown"}`,
    );
    this.name = "CtwaIngestError";
    this.reason = reason;
    this.detail = detail;
  }
}

/** Type guard for the route's `.catch`: an expected CTWA intake failure vs an
 *  unexpected programming error. Same package as the throw site, so `instanceof`
 *  is safe (no cross-dist duplication of the class). */
export function isCtwaIngestError(value: unknown): value is CtwaIngestError {
  return value instanceof CtwaIngestError;
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

    const response = await this.deps.ingress.submit({
      intent: "lead.intake",
      payload: intake,
      idempotencyKey: intake.idempotencyKey,
      ...(opts.parentWorkUnitId ? { parentWorkUnitId: opts.parentWorkUnitId } : {}),
    });

    // P2-4: do NOT swallow a failed lead.intake. A CTWA lead is a paid lead; a
    // silently-dropped intake is invisible today (the submit return was
    // discarded). Throw on both failure legs so the caller's fire-and-forget
    // `.catch` surfaces the drop (log + metric). Throwing keeps the intake
    // non-blocking — the caller already `void`s this promise.
    if (!response.ok) {
      // ok:false — PlatformIngress rejected the work BEFORE execution (infra /
      // entitlement / validation). The app-layer shim threads the IngressError
      // type/message onto `response.error`.
      throw new CtwaIngestError("ingress_rejected", {
        ...(response.error?.type ? { type: response.error.type } : {}),
        ...(response.error?.message ? { message: response.error.message } : {}),
      });
    }

    // ok:true — ingress accepted the work. Surface only an EXPLICIT "failed"
    // execution outcome (gate on the explicit value, not absence): a real
    // "completed", the minimal `{}` result shapes, and any unknown/stale shape
    // stay quiet, because ok:true already means ingress accepted the submission
    // and the dominant failure mode (ok:false) is caught above regardless.
    const outcome = (response.result as { outcome?: unknown } | undefined)?.outcome;
    if (outcome === "failed") {
      throw new CtwaIngestError("execution_failed", { outcome: "failed" });
    }
  }
}
