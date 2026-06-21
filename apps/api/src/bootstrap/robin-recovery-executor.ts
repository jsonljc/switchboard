import type { WorkflowHandler } from "@switchboard/core/platform";
import {
  evaluateProactiveSendEligibility,
  getMetrics,
  type RobinRecoverySendStore,
} from "@switchboard/core";
import { RobinRecoveryCampaignParamsSchema, buildRecoveryDedupeKey } from "@switchboard/schemas";
import { ROBIN_RECOVERY_SEND_INTENT } from "../services/workflows/robin-recovery-request.js";
import { resolveWhatsAppSendToken } from "../lib/whatsapp-send-token.js";
import {
  dispatchRecoveryRow,
  evaluateRecoveryEligibility,
  isOrgConfigSkip,
  defaultSendTemplate,
  type RecoverySendContext,
  type RecoveryTemplateSendArgs,
  type RecoveryTemplateSendResult,
} from "./robin-recovery-send-core.js";

const RECOVERY_CAMPAIGN_KIND = "no_show";

export type {
  RecoverySendContext,
  RecoveryTemplateSendArgs,
  RecoveryTemplateSendResult,
} from "./robin-recovery-send-core.js";

export interface RobinRecoverySendExecutorDeps {
  /** Org-scoped per-recipient phone + consent + org-name + template-approval-overlay resolution. */
  getSendContext: (orgId: string, contactId: string) => Promise<RecoverySendContext>;
  store: RobinRecoverySendStore;
  /** Injectable for tests; defaults to the real Graph send. */
  sendTemplate?: (args: RecoveryTemplateSendArgs) => Promise<RecoveryTemplateSendResult>;
  selectTemplateFn?: Parameters<typeof evaluateProactiveSendEligibility>[0]["selectTemplateFn"];
  resolveSendToken?: () => string | undefined;
  resolvePhoneNumberId?: () => string | undefined;
  /**
   * Multi-tenant: resolve the campaign org's own WhatsApp {token, phoneNumberId}.
   * Returns null when the org has no whatsapp connection; the campaign then falls
   * back PER-FIELD to the global token (resolveSendToken) + env phone id
   * (resolvePhoneNumberId). Resolved ONCE per campaign (all candidates share one
   * org). Defaults to a null-returning resolver so existing wiring/tests keep the
   * global path.
   */
  resolveOrgSendCreds?: (
    organizationId: string,
  ) => Promise<{ token: string | null; phoneNumberId: string | null } | null>;
  /**
   * rank 14: re-check future bookings at SEND time. The dispatch-side self-rebook exclusion is frozen
   * at dispatch; a contact who rebooked between then and this (post-approval) send must not be
   * re-engaged. Resolved ONCE over the cohort. Absent -> no rebooked contacts (re-check is inert).
   */
  findFutureBookingContactIds?: (
    orgId: string,
    contactIds: string[],
    now: Date,
  ) => Promise<Set<string>>;
  /** Injectable clock for the rebooked re-check; defaults to wall-clock. */
  now?: () => Date;
  /** Injectable RNG for the retry backoff full-jitter; defaults to Math.random. */
  random?: () => number;
}

function isUniqueConstraintError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

/**
 * Robin v1 no-show recovery campaign executor. On dispatch of an APPROVED campaign it iterates the
 * frozen cohort and, per recipient: claim-first inserts a dedup row (P2002 -> skip, never re-send),
 * resolves phone + consent org-scoped at dispatch, consent-gates via evaluateProactiveSendEligibility
 * (re-engagement-offer intent class, marketing allowed), sends the WhatsApp template, and records the
 * outcome. FAIL-CLOSED: no approved template / consent pending or revoked / no phone / missing creds /
 * an already-contacted dedup hit -> SKIP with a recorded reason, never a send. Consent is never
 * bypassed (PlatformIngress.submit does NOT auto-fire the consent gate for a proactive/cron send).
 */
export function buildRobinRecoverySendExecutor(deps: RobinRecoverySendExecutorDeps): {
  intent: string;
  handler: WorkflowHandler;
} {
  const sendTemplate = deps.sendTemplate ?? defaultSendTemplate;
  const resolveToken = deps.resolveSendToken ?? resolveWhatsAppSendToken;
  const resolvePhoneId =
    deps.resolvePhoneNumberId ?? (() => process.env["WHATSAPP_PHONE_NUMBER_ID"]);
  const resolveOrgSendCreds = deps.resolveOrgSendCreds ?? (async () => null);
  const random = deps.random ?? Math.random;

  return {
    intent: ROBIN_RECOVERY_SEND_INTENT,
    handler: {
      async execute(workUnit) {
        const parsed = RobinRecoveryCampaignParamsSchema.safeParse(workUnit.parameters);
        if (!parsed.success) {
          return {
            outcome: "failed",
            summary: "Recovery campaign rejected: malformed frozen cohort",
            error: { code: "ROBIN_RECOVERY_INVALID_COHORT", message: parsed.error.message },
          };
        }
        const orgId = workUnit.organizationId;
        const { candidates } = parsed.data;

        // WhatsApp send creds, resolved ONCE per campaign (all candidates share the org).
        // Multi-tenant: prefer the campaign org's own send creds, PER-FIELD falling back to the
        // global token + env phone id (single-tenant pilot) so a partial per-org row never
        // dark-holes the deployment-wide config. Missing creds are an org-wide config gap, NOT a
        // per-recipient decision: skip the whole campaign WITHOUT claiming any dedup rows, so a
        // later run (once creds are set) can still re-engage this cohort. Loud + countable (the
        // dark-funnel metric).
        const perOrg = await resolveOrgSendCreds(orgId);
        const accessToken = perOrg?.token ?? resolveToken();
        const phoneNumberId = perOrg?.phoneNumberId ?? resolvePhoneId();
        if (!accessToken || !phoneNumberId) {
          console.warn(
            "[robin.recovery_campaign.send] WhatsApp send token or phone id missing " +
              "(set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID); recovery campaign skipped org-wide.",
          );
          getMetrics().whatsappProactiveSendSkipped.inc({
            intent: ROBIN_RECOVERY_SEND_INTENT,
            reason: "config_missing",
          });
          return {
            outcome: "completed",
            summary: "WhatsApp not configured; recovery campaign skipped",
            outputs: {
              sent: 0,
              skipped: candidates.length,
              failed: 0,
              total: candidates.length,
              skipReason: "config_missing",
            },
          };
        }

        let sent = 0;
        let skipped = 0;
        let failed = 0;

        const now = (deps.now ?? (() => new Date()))();
        // rank 14: re-check future bookings at SEND time. The dispatch-side self-rebook exclusion is
        // frozen at dispatch; a contact who rebooked between then and this (post-approval) send must
        // not be re-engaged. Batch-resolved once over the cohort; an absent resolver -> no rebooked
        // contacts (the re-check is inert until wired).
        const rebookedContactIds = deps.findFutureBookingContactIds
          ? await deps.findFutureBookingContactIds(
              orgId,
              candidates.map((c) => c.contactId),
              now,
            )
          : new Set<string>();

        for (const candidate of candidates) {
          // Resolve consent / jurisdiction / phone / template-approval BEFORE claiming. An org-wide
          // config gap (a draft or absent template) must burn NO dedup rows (rank 7), mirroring the
          // creds short-circuit. A transient resolve failure here is isolated and claims nothing, so a
          // later run re-resolves (no stranded pending row, no silent under-delivery).
          let ctx: RecoverySendContext;
          try {
            ctx = await deps.getSendContext(orgId, candidate.contactId);
          } catch (err) {
            console.warn(
              `[robin.recovery_campaign.send] context resolve failed for contact ${candidate.contactId}; ` +
                `skipped without claiming: ${err instanceof Error ? err.message : String(err)}`,
            );
            failed++;
            continue;
          }

          const eligibility = evaluateRecoveryEligibility(ctx, deps.selectTemplateFn);

          // rank 7: a template that is unapproved (an org-wide approval gap, identical for every
          // candidate) or absent (e.g. a not-yet-stamped jurisdiction, per-recipient) is a config/data
          // gap, not a send decision worth burning a dedup row -> skip WITHOUT claiming, so a later run
          // re-engages once the template is approved (or the jurisdiction is set).
          if (isOrgConfigSkip(eligibility)) {
            skipped++;
            continue;
          }

          // CLAIM: insert the dedup row now that a send is actually intended. A P2002 means this no-show
          // was already contacted (a prior overlapping campaign or a concurrent/retried dispatch) ->
          // SKIP, never re-send. The unique(dedupeKey) is the idempotency guard right before the send.
          let rowId: string;
          try {
            rowId = (
              await deps.store.create({
                organizationId: orgId,
                contactId: candidate.contactId,
                bookingId: candidate.bookingId,
                campaignKind: RECOVERY_CAMPAIGN_KIND,
                campaignWorkUnitId: workUnit.id,
                dedupeKey: buildRecoveryDedupeKey(
                  orgId,
                  candidate.bookingId,
                  RECOVERY_CAMPAIGN_KIND,
                ),
              })
            ).id;
          } catch (err) {
            if (isUniqueConstraintError(err)) {
              skipped++;
              continue;
            }
            throw err;
          }

          // Post-claim per-recipient send + state-write + backoff, the SHARED path the retry executor
          // also calls. A send failure schedules retry-1 (attempts 0 is never terminal at MAX=3), so the
          // cohort first attempt re-queues rather than dead-letters; markSkipped paths stay terminal.
          const r = await dispatchRecoveryRow(
            {
              rowId,
              attempts: 0,
              ctx,
              eligibility,
              rebooked: rebookedContactIds.has(candidate.contactId),
              accessToken,
              phoneNumberId,
            },
            { store: deps.store, sendTemplate, now: () => now, random, onDeadLetter: undefined },
          );
          if (r.outcome === "sent") sent++;
          else if (r.outcome === "skipped") skipped++;
          else failed++;
        }

        return {
          outcome: "completed",
          summary: `Recovery campaign dispatched: ${sent} sent, ${skipped} skipped, ${failed} failed`,
          outputs: { sent, skipped, failed, total: candidates.length },
        };
      },
    },
  };
}
