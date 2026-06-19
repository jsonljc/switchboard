import type { WorkflowHandler } from "@switchboard/core/platform";
import {
  evaluateProactiveSendEligibility,
  getMetrics,
  type RobinRecoverySendStore,
  type TemplateApprovalOverlay,
} from "@switchboard/core";
import {
  RobinRecoveryCampaignParamsSchema,
  buildRecoveryDedupeKey,
  type IntentClass,
  type PdpaJurisdiction,
} from "@switchboard/schemas";
import { ROBIN_RECOVERY_SEND_INTENT } from "../services/workflows/robin-recovery-request.js";
import { resolveWhatsAppSendToken } from "../lib/whatsapp-send-token.js";

const RECOVERY_INTENT_CLASS: IntentClass = "re-engagement-offer";
const RECOVERY_CAMPAIGN_KIND = "no_show";

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

export interface RobinRecoverySendExecutorDeps {
  /** Org-scoped per-recipient phone + consent + org-name + template-approval-overlay resolution. */
  getSendContext: (orgId: string, contactId: string) => Promise<RecoverySendContext>;
  store: RobinRecoverySendStore;
  /** Injectable for tests; defaults to the real Graph send. */
  sendTemplate?: (args: RecoveryTemplateSendArgs) => Promise<RecoveryTemplateSendResult>;
  selectTemplateFn?: Parameters<typeof evaluateProactiveSendEligibility>[0]["selectTemplateFn"];
  resolveSendToken?: () => string | undefined;
  resolvePhoneNumberId?: () => string | undefined;
}

function isUniqueConstraintError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

async function defaultSendTemplate(
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

        // Service-level WhatsApp send creds (single-tenant pilot; per-org creds are the known
        // multi-tenant follow-up). Missing creds are an org-wide config gap, NOT a per-recipient
        // decision: skip the whole campaign WITHOUT claiming any dedup rows, so a later run (once
        // creds are set) can still re-engage this cohort. Loud + countable (the dark-funnel metric).
        const accessToken = resolveToken();
        const phoneNumberId = resolvePhoneId();
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

        for (const candidate of candidates) {
          const dedupeKey = buildRecoveryDedupeKey(
            orgId,
            candidate.bookingId,
            RECOVERY_CAMPAIGN_KIND,
          );

          // CLAIM-FIRST: insert the dedup row before resolving/sending. A P2002 means this no-show
          // was already contacted (a prior week's overlapping campaign, or a concurrent/retried
          // dispatch) -> SKIP, never re-send. This is what makes the send idempotent under retry.
          let rowId: string;
          try {
            rowId = (
              await deps.store.create({
                organizationId: orgId,
                contactId: candidate.contactId,
                bookingId: candidate.bookingId,
                campaignKind: RECOVERY_CAMPAIGN_KIND,
                campaignWorkUnitId: workUnit.id,
                dedupeKey,
              })
            ).id;
          } catch (err) {
            if (isUniqueConstraintError(err)) {
              skipped++;
              continue;
            }
            throw err;
          }

          // Everything after the claim is wrapped so a transient error (a DB read blip, a network
          // reject, etc.) is ISOLATED to this recipient: it never throws the whole batch and never
          // strands the already-claimed row as pending (which a retry would P2002-skip = silent
          // under-delivery). On a throw the row is marked failed (terminal, single-attempt) and the
          // loop moves on. Note: consent is still strictly checked BEFORE any send below.
          try {
            // Resolve phone + consent org-scoped AT DISPATCH so consent is re-validated at send time
            // (the recipient phone is deliberately not frozen in the cohort).
            const ctx = await deps.getSendContext(orgId, candidate.contactId);

            const eligibility = evaluateProactiveSendEligibility({
              contact: {
                pdpaJurisdiction: ctx.pdpaJurisdiction,
                consentGrantedAt: ctx.consentGrantedAt,
                consentRevokedAt: ctx.consentRevokedAt,
                messagingOptIn: ctx.messagingOptIn,
              },
              lastWhatsAppInboundAt: ctx.lastWhatsAppInboundAt,
              intentClass: RECOVERY_INTENT_CLASS,
              jurisdiction: ctx.jurisdiction,
              // A no-show re-engagement is inherently a MARKETING-class message (the only
              // re-engagement-offer template is marketing). The real controls are the per-campaign
              // manager approval + the per-recipient PDPA proactive consent gate, not this flag;
              // with it false the only available template is unreachable and the executor is inert.
              allowMarketingTemplate: true,
              selectTemplateFn: deps.selectTemplateFn,
              approvalOverlay: ctx.approvalOverlay,
            });

            if (!eligibility.eligible) {
              await deps.store.markSkipped(rowId, eligibility.reason);
              skipped++;
              continue;
            }
            if (!ctx.phone) {
              await deps.store.markSkipped(rowId, "missing_contact_phone");
              skipped++;
              continue;
            }

            const result = await sendTemplate({
              accessToken,
              phoneNumberId,
              to: ctx.phone,
              metaTemplateName: eligibility.template.metaTemplateName,
              leadName: ctx.leadName,
              businessName: ctx.businessName,
            });
            if (!result.ok) {
              await deps.store.markFailed(rowId, result.error ?? "whatsapp_send_failed");
              failed++;
              continue;
            }
            await deps.store.markSent(rowId, result.messageId ?? null);
            sent++;
          } catch (err) {
            await deps.store.markFailed(rowId, err instanceof Error ? err.message : String(err));
            failed++;
          }
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
