import {
  evaluateProactiveSendEligibility,
  ROBIN_RECOVERY_MAX_SEND_ATTEMPTS,
  ROBIN_RECOVERY_RETRY_BASE_MS,
  ROBIN_RECOVERY_RETRY_CAP_MS,
  type RobinRecoverySendStore,
  type ProactiveSendEligibility,
  type TemplateApprovalOverlay,
} from "@switchboard/core";
import type { IntentClass, PdpaJurisdiction } from "@switchboard/schemas";

/**
 * Shared recovery send + backoff core. Both the cohort executor (first attempt) and the retry
 * executor (reclaims) call `dispatchRecoveryRow`, so there is ONE send + consent/template gate +
 * state-write + backoff path. `computeRecoveryNextRetry` implements capped-exponential + full-jitter
 * backoff with a terminal (null) at the attempt cap; only the retry executor ever observes a null
 * (the cohort always starts at attempts=0, which is never terminal at MAX=3).
 */

/** The intent class for the no-show re-engagement template (the only marketing recovery template). */
const RECOVERY_INTENT_CLASS: IntentClass = "re-engagement-offer";
export { RECOVERY_INTENT_CLASS };

/** Per-recipient send context resolved at dispatch (org-scoped). Mirrors ReminderSendContext. */
export interface RecoverySendContext {
  consentGrantedAt: Date | string | null;
  consentRevokedAt: Date | string | null;
  pdpaJurisdiction: PdpaJurisdiction | null;
  messagingOptIn: boolean;
  lastWhatsAppInboundAt: Date | null;
  jurisdiction: "SG" | "MY" | null;
  leadName: string;
  businessName: string;
  phone: string | null;
  approvalOverlay?: TemplateApprovalOverlay;
}

export interface RecoveryTemplateSendArgs {
  accessToken: string;
  phoneNumberId: string;
  to: string;
  metaTemplateName: string;
  leadName: string;
  businessName: string;
}
export interface RecoveryTemplateSendResult {
  ok: boolean;
  messageId?: string | null;
  error?: string;
}

export interface DispatchRecoveryRowDeps {
  store: RobinRecoverySendStore;
  sendTemplate: (a: RecoveryTemplateSendArgs) => Promise<RecoveryTemplateSendResult>;
  now: () => Date;
  random: () => number;
  /** Fired exactly once when a row dead-letters (computeRecoveryNextRetry returned null). */
  onDeadLetter?: (reason: string) => void;
}

export interface DispatchRecoveryRowArgs {
  rowId: string;
  /** The row's CURRENT attempts BEFORE this send (the cohort first attempt is 0). */
  attempts: number;
  ctx: RecoverySendContext;
  eligibility: ProactiveSendEligibility;
  rebooked: boolean;
  accessToken: string;
  phoneNumberId: string;
}

/**
 * Capped-exponential + FULL-JITTER backoff. Returns the next retry time, or null when the NEXT
 * attempt would reach ROBIN_RECOVERY_MAX_SEND_ATTEMPTS (terminal -> dead-letter). The delay window
 * doubles per attempt (BASE * 2^attempts), capped at CAP, and the actual delay is a uniform draw
 * from [0, window) via floor(random() * window) -> full jitter, immediate (now) at random()=>0. A
 * non-finite attempts count is treated as terminal (defensive).
 */
export function computeRecoveryNextRetry(
  currentAttempts: number,
  now: Date,
  random: () => number,
): Date | null {
  if (
    !Number.isFinite(currentAttempts) ||
    currentAttempts + 1 >= ROBIN_RECOVERY_MAX_SEND_ATTEMPTS
  ) {
    return null;
  }
  const capped = Math.min(
    ROBIN_RECOVERY_RETRY_BASE_MS * 2 ** currentAttempts,
    ROBIN_RECOVERY_RETRY_CAP_MS,
  );
  const jitter = Math.floor(Math.min(1, Math.max(0, random())) * capped); // full jitter [0, capped)
  return new Date(now.getTime() + jitter);
}

/**
 * An org-wide config/data gap (an unapproved or absent template) is NOT a per-recipient send
 * decision worth burning a dedup row on. The cohort executor calls this PRE-CLAIM to skip without
 * claiming, so a later run re-engages once the template is approved (or the jurisdiction is set).
 */
export function isOrgConfigSkip(eligibility: ProactiveSendEligibility): boolean {
  return (
    !eligibility.eligible &&
    (eligibility.reason === "template_not_approved" || eligibility.reason === "no_template")
  );
}

/**
 * Wrap evaluateProactiveSendEligibility with the recovery campaign's fixed params: the
 * re-engagement-offer intent class with marketing allowed (the only recovery template is marketing;
 * the real controls are the per-campaign manager approval + the per-recipient PDPA proactive consent
 * gate, not this flag). `selectTemplateFn` is injectable for tests.
 */
export function evaluateRecoveryEligibility(
  ctx: RecoverySendContext,
  selectTemplateFn?: Parameters<typeof evaluateProactiveSendEligibility>[0]["selectTemplateFn"],
): ProactiveSendEligibility {
  return evaluateProactiveSendEligibility({
    contact: {
      pdpaJurisdiction: ctx.pdpaJurisdiction,
      consentGrantedAt: ctx.consentGrantedAt,
      consentRevokedAt: ctx.consentRevokedAt,
      messagingOptIn: ctx.messagingOptIn,
    },
    lastWhatsAppInboundAt: ctx.lastWhatsAppInboundAt,
    intentClass: RECOVERY_INTENT_CLASS,
    jurisdiction: ctx.jurisdiction,
    allowMarketingTemplate: true,
    selectTemplateFn,
    approvalOverlay: ctx.approvalOverlay,
  });
}

/**
 * Mark a claimed row failed and compute whether it dead-letters. A transient failure (next attempt
 * below the cap) re-queues the SAME row (status pending + nextRetryAt) for the retry cron; a terminal
 * failure (cap reached) dead-letters (status failed, nextRetryAt cleared) and fires onDeadLetter.
 */
async function finishFailed(
  rowId: string,
  attempts: number,
  error: string,
  deps: DispatchRecoveryRowDeps,
): Promise<{ outcome: "failed"; deadLettered: boolean }> {
  const nextRetryAt = computeRecoveryNextRetry(attempts, deps.now(), deps.random);
  await deps.store.markFailed(rowId, error, nextRetryAt);
  if (nextRetryAt === null) deps.onDeadLetter?.("max_retries_exhausted");
  return { outcome: "failed", deadLettered: nextRetryAt === null };
}

/**
 * The shared send + per-recipient state-write + backoff path for an ALREADY-CLAIMED row. Terminal
 * per-recipient decisions (rebooked / consent-or-template ineligible / no phone) record a SKIP and
 * are never retried. A send failure (Graph !ok or a thrown error) routes through finishFailed, which
 * re-queues for retry below the cap or dead-letters at it.
 */
export async function dispatchRecoveryRow(
  args: DispatchRecoveryRowArgs,
  deps: DispatchRecoveryRowDeps,
): Promise<{ outcome: "sent" | "skipped" | "failed"; deadLettered: boolean }> {
  const { rowId, attempts, ctx, eligibility, rebooked } = args;

  // A contact who rebooked between dispatch and now must not be re-engaged. This IS a terminal
  // per-recipient decision (unlike the org-config gate), so the dedup row is kept.
  if (rebooked) {
    await deps.store.markSkipped(rowId, "already_rebooked");
    return { outcome: "skipped", deadLettered: false };
  }
  if (!eligibility.eligible) {
    await deps.store.markSkipped(rowId, eligibility.reason);
    return { outcome: "skipped", deadLettered: false };
  }
  if (!ctx.phone) {
    await deps.store.markSkipped(rowId, "missing_contact_phone");
    return { outcome: "skipped", deadLettered: false };
  }

  try {
    const result = await deps.sendTemplate({
      accessToken: args.accessToken,
      phoneNumberId: args.phoneNumberId,
      to: ctx.phone,
      metaTemplateName: eligibility.template.metaTemplateName,
      leadName: ctx.leadName,
      businessName: ctx.businessName,
    });
    if (!result.ok) {
      return finishFailed(rowId, attempts, result.error ?? "whatsapp_send_failed", deps);
    }
    await deps.store.markSent(rowId, result.messageId ?? null);
    return { outcome: "sent", deadLettered: false };
  } catch (err) {
    return finishFailed(rowId, attempts, err instanceof Error ? err.message : String(err), deps);
  }
}

/** The real Graph WhatsApp template send. Injectable in tests via DispatchRecoveryRowDeps.sendTemplate. */
export async function defaultSendTemplate(
  args: RecoveryTemplateSendArgs,
): Promise<RecoveryTemplateSendResult> {
  const response = await fetch(`https://graph.facebook.com/v21.0/${args.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: args.to,
      type: "template",
      template: {
        name: args.metaTemplateName,
        language: { code: "en" },
        // The re-engagement-offer template declares two variables: lead_name, business_name.
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: args.leadName },
              { type: "text", text: args.businessName },
            ],
          },
        ],
      },
    }),
  });
  if (!response.ok) return { ok: false, error: await response.text() };
  const json = (await response.json()) as { messages?: Array<{ id?: string }> };
  return { ok: true, messageId: json.messages?.[0]?.id ?? null };
}
