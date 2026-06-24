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
 * The EFFECTIVE WhatsApp send creds for a campaign org, or the reason no safe pair could be formed.
 * `org_phone_missing` is the multi-tenant fail-closed: a per-org connection exists but lacks its own
 * phone number id, so there is NO number we may send the tenant's patients from (we will NOT borrow
 * a global/pilot number). `config_missing` is the deployment-wide gap (the single-tenant pilot env
 * is unset, or no send token resolves anywhere).
 */
export type EffectiveSendCreds =
  | { ok: true; accessToken: string; phoneNumberId: string }
  | { ok: false; reason: "config_missing" | "org_phone_missing" };

/**
 * Resolve the effective WhatsApp send creds for a campaign org, FAIL-CLOSED on the multi-tenant
 * isolation boundary.
 *
 * The phone number id is the FROM-identity and the tenant-isolation boundary: when the org has its
 * own `Connection` (`perOrg` non-null) it MUST send from its OWN number, so a missing org phone id
 * fails closed (`org_phone_missing`) instead of falling back to the global/pilot number — sending a
 * second tenant's patient from the first tenant's number is the cross-tenant leak this guards. The
 * token is NOT an isolation boundary (it only authorizes the call): it MAY fall back to the global
 * system-user token, matching the Meta Tech Provider model (one system token, many per-org WABA
 * numbers). With NO per-org connection at all (`perOrg` null) this is the single-tenant pilot, which
 * legitimately uses the global token + global phone id (both required, else `config_missing`).
 */
export function resolveEffectiveSendCreds(
  perOrg: { token: string | null; phoneNumberId: string | null } | null,
  globalToken: string | undefined,
  globalPhoneNumberId: string | undefined,
): EffectiveSendCreds {
  if (perOrg === null) {
    // Single-tenant pilot: no per-org connection. Use the global creds; both are required.
    if (!globalToken || !globalPhoneNumberId) return { ok: false, reason: "config_missing" };
    return { ok: true, accessToken: globalToken, phoneNumberId: globalPhoneNumberId };
  }
  // A per-org connection EXISTS. The phone id is the tenant FROM-identity: org-only, NEVER global.
  if (!perOrg.phoneNumberId) return { ok: false, reason: "org_phone_missing" };
  // The token authorizes only; it may fall back to the global system-user token (Tech Provider).
  const accessToken = perOrg.token ?? globalToken;
  if (!accessToken) return { ok: false, reason: "config_missing" };
  return { ok: true, accessToken, phoneNumberId: perOrg.phoneNumberId };
}

/**
 * An org-wide config/data gap (an unapproved or absent template) is NOT a per-recipient send
 * decision worth burning a dedup row on. The cohort executor calls this PRE-CLAIM to skip without
 * claiming, so a later run re-engages once the template is approved (or the jurisdiction is set).
 */
export function isOrgConfigSkip(
  eligibility: ProactiveSendEligibility,
): eligibility is Extract<ProactiveSendEligibility, { eligible: false }> {
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

  // Pre-send claim: remove this row from the retry-due set BEFORE the Graph call. findDue only
  // reclaims rows with a due nextRetryAt, so clearing it now means a crash OR a failed markSent AFTER
  // a successful send can never re-queue this row -> the patient is never messaged twice
  // (at-most-once). On the cohort path the row is already non-due (nextRetryAt null), so this is a
  // no-op; on the retry path it clears the due time that selected the row this tick.
  await deps.store.markSendInFlight(rowId);

  let result: RecoveryTemplateSendResult;
  try {
    result = await deps.sendTemplate({
      accessToken: args.accessToken,
      phoneNumberId: args.phoneNumberId,
      to: ctx.phone,
      metaTemplateName: eligibility.template.metaTemplateName,
      leadName: ctx.leadName,
      businessName: ctx.businessName,
    });
  } catch (err) {
    // The send threw before a provider ack -> a transient send failure, re-queueable below the cap.
    return finishFailed(rowId, attempts, err instanceof Error ? err.message : String(err), deps);
  }
  if (!result.ok) {
    return finishFailed(rowId, attempts, result.error ?? "whatsapp_send_failed", deps);
  }

  // SEND SUCCEEDED — the patient has been messaged. From here we MUST NOT re-queue: persisting the
  // outcome is a bookkeeping write, retried as a write (by the stalled-pending reaper), NEVER as a
  // re-send. If markSent fails the row stays pending with a null nextRetryAt (markSendInFlight above),
  // which findDue never re-selects, so it cannot double-send; surface the anomaly loudly.
  try {
    await deps.store.markSent(rowId, result.messageId ?? null);
  } catch (err) {
    console.error(
      `[robin.recovery] send SUCCEEDED but markSent failed for row ${rowId}; left non-due to ` +
        `prevent a double-send (stalled-pending reaper will reconcile): ${
          err instanceof Error ? err.message : String(err)
        }`,
    );
  }
  return { outcome: "sent", deadLettered: false };
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
