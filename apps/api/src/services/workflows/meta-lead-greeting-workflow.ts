import type { WorkflowHandler } from "@switchboard/core/platform";
import {
  evaluateProactiveSendEligibility,
  getMetrics,
  type TemplateApprovalOverlay,
} from "@switchboard/core";
import type { IntentClass, PdpaJurisdiction } from "@switchboard/schemas";
import { jurisdictionFromE164, normalizeToE164 } from "@switchboard/schemas";
import { resolveWhatsAppSendToken } from "../../lib/whatsapp-send-token.js";

/** Telemetry intent label for the first-touch greeting send path. */
const GREETING_INTENT = "meta.lead.greeting.send";

/** The registry intent class for the first-touch greeting template (SG/MY, marketing). */
const GREETING_INTENT_CLASS: IntentClass = "first-touch-greeting";

/**
 * Consent + send inputs for the first-touch Meta-lead greeting, scoped to (org, contact).
 *
 * A first-touch greeting is a business-initiated PROACTIVE WhatsApp template send, so it MUST
 * clear the SAME approved-template + source-aware opt-in gate its reminder/follow-up siblings
 * enforce (`evaluateProactiveSendEligibility`), not a consent-only check + a raw template POST.
 * The fields below are exactly the eligibility inputs, assembled per-org by `getSendContext`
 * (see `buildWhatsAppSendContext` in contained-workflows.ts):
 *
 *  - `messagingOptIn` is the source-aware opt-in basis: an Instant-Form lead's ad-form opt-in,
 *    or a CTWA lead's ad-click opt-in (both recorded as messagingOptIn=true at lead intake).
 *  - `lastWhatsAppInboundAt` lets a genuine inbound-bearing CTWA lead ride the 24h
 *    free-entry-point window even without messagingOptIn.
 *  - `jurisdiction` selects the SG/MY first-touch template; when the contact has no stamped
 *    `pdpaJurisdiction` yet (the common brand-new-lead case) the workflow falls back to the
 *    lead's phone country code.
 *  - `approvalOverlay` is the org-resolvable Meta approval status; the static template ships
 *    `draft`, so an unapproved greeting template is BLOCKED until the org approves it.
 */
export interface GreetingSendContext {
  consentGrantedAt: Date | string | null;
  consentRevokedAt: Date | string | null;
  pdpaJurisdiction: PdpaJurisdiction | null;
  messagingOptIn: boolean;
  lastWhatsAppInboundAt: Date | null;
  jurisdiction: "SG" | "MY" | null;
  /** Org display name, rendered into the first message as sender identity (PDPA DNC). */
  businessName: string;
  /** Org-resolvable template-approval source (metaTemplateName -> status). */
  approvalOverlay?: TemplateApprovalOverlay;
}

export interface MetaLeadGreetingDeps {
  /** Reads the consent + send context for (orgId, contactId). */
  getSendContext: (orgId: string, contactId: string) => Promise<GreetingSendContext>;
  /**
   * Multi-tenant: resolve the sending org's own WhatsApp {token, phoneNumberId}.
   * Returns null when the org has no whatsapp connection; the call site then
   * falls back PER-FIELD to the global env values (single-tenant pilot). Defaults
   * to a null-returning resolver so existing wiring/tests keep the env-only path.
   */
  resolveOrgSendCreds?: (
    organizationId: string,
  ) => Promise<{ token: string | null; phoneNumberId: string | null } | null>;
}

interface GreetingParams {
  contactId: string;
  phone: string;
  firstName: string;
}

/**
 * First-touch greeting to a new Meta lead. The greeting is a business-initiated PROACTIVE
 * WhatsApp template send, so — like its sibling reminder/follow-up workflows — it is gated on
 * `evaluateProactiveSendEligibility`, which enforces (in strictest-first order):
 *
 *   1. the PDPA proactive consent bar (revocation ALWAYS blocks; a brand-new lead's not-yet-
 *      granted "pending" state is relaxed via `firstTouch` and deferred to the opt-in basis);
 *   2. the source-aware opt-in / 24h-window basis (Instant-Form ad-form opt-in, or a genuine
 *      inbound-bearing CTWA conversation; a bare click with neither is blocked `no_optin`);
 *   3. an APPROVED, jurisdiction-matched Marketing template (a draft/unapproved one is blocked
 *      `template_not_approved`, since Meta hard-rejects unapproved templates anyway).
 *
 * The first message carries sender identity ({{business_name}}) + an opt-out path (reply STOP)
 * per SG DNC ss.44/45 and MY PDPA s.43. Every block path records its reason (WorkTrace is
 * canonical persistence) — the send is GATED and the decision RECORDED, never a silent send.
 */
export function buildMetaLeadGreetingWorkflow(deps: MetaLeadGreetingDeps): WorkflowHandler {
  const resolveOrgSendCreds = deps.resolveOrgSendCreds ?? (async () => null);
  return {
    async execute(workUnit) {
      const input = workUnit.parameters as unknown as GreetingParams;

      if (!input.phone) {
        // Single-attempt: record a clean skip rather than a retryable failure. Checked before
        // the send-context read since a phoneless lead can never be greeted on WhatsApp.
        return {
          outcome: "completed",
          summary: "Greeting skipped: contact has no phone",
          outputs: { sent: false, skipReason: "missing_contact_phone" },
        };
      }

      const ctx = await deps.getSendContext(workUnit.organizationId, input.contactId);

      // Normalize the raw IF/webhook phone once. A brand-new lead has no stamped
      // pdpaJurisdiction yet (it is stamped later, when a governed conversation begins), so the
      // first-touch template jurisdiction falls back to the lead's phone country code; a bare
      // local number (no +65/+60 prefix) would otherwise dark-hole at no_template. A stamped
      // jurisdiction always wins. Fail closed: an un-normalizable number keeps its raw form and
      // resolves to no jurisdiction -> no_template (recorded, never an unconditional send).
      const sendPhone = normalizeToE164(input.phone) ?? input.phone;
      const jurisdiction = ctx.jurisdiction ?? jurisdictionFromE164(sendPhone);

      const eligibility = evaluateProactiveSendEligibility({
        contact: {
          pdpaJurisdiction: ctx.pdpaJurisdiction,
          consentGrantedAt: ctx.consentGrantedAt,
          consentRevokedAt: ctx.consentRevokedAt,
          messagingOptIn: ctx.messagingOptIn,
        },
        lastWhatsAppInboundAt: ctx.lastWhatsAppInboundAt,
        intentClass: GREETING_INTENT_CLASS,
        jurisdiction,
        // A first-touch greeting is inherently a Marketing-category message (the only first-touch
        // template is marketing). The real controls are the per-org approved-template overlay +
        // the PDPA proactive consent gate + the source-aware opt-in/window, not this flag — same
        // reasoning as robin-recovery-executor's re-engagement send.
        allowMarketingTemplate: true,
        approvalOverlay: ctx.approvalOverlay,
        // A brand-new lead has no captured PDPA grant yet; its lawful basis is the opt-in/window
        // checked above, so relax ONLY the consent_pending block (revocation still wins).
        firstTouch: true,
      });

      if (!eligibility.eligible) {
        return {
          outcome: "completed",
          summary: `Greeting skipped: ${eligibility.reason}`,
          outputs: { sent: false, skipReason: eligibility.reason },
        };
      }

      // Multi-tenant: prefer the sending org's own send creds; PER-FIELD fall back
      // to the global env values (single-tenant pilot) so a partial per-org row
      // never dark-holes the deployment-wide config.
      const perOrg = await resolveOrgSendCreds(workUnit.organizationId);
      const accessToken = perOrg?.token ?? resolveWhatsAppSendToken();
      const phoneNumberId = perOrg?.phoneNumberId ?? process.env["WHATSAPP_PHONE_NUMBER_ID"];
      if (!accessToken || !phoneNumberId) {
        // Infra config gap, not a per-contact decision: with no send token/phone id EVERY lead
        // greeting silently no-ops org-wide. Make it loud + countable (distinct from the benign
        // per-contact skips above, which carry only a skipReason) so the dark funnel is visible.
        console.warn(
          "[meta.lead.greeting.send] WhatsApp send token or phone id missing " +
            "(set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID); greeting skipped org-wide.",
        );
        getMetrics().whatsappProactiveSendSkipped.inc({
          intent: GREETING_INTENT,
          reason: "config_missing",
        });
        return {
          outcome: "completed",
          summary: "WhatsApp not configured; greeting skipped",
          outputs: { sent: false, skipReason: "unsupported_channel" },
        };
      }

      const response = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: sendPhone,
          type: "template",
          template: {
            name: eligibility.template.metaTemplateName,
            language: { code: "en" },
            components: [
              {
                type: "body",
                // {{lead_name}}, {{business_name}} — the first message greets by name and
                // identifies the sender. Order MUST match the template's variable order.
                parameters: [
                  { type: "text", text: input.firstName },
                  { type: "text", text: ctx.businessName },
                ],
              },
            ],
          },
        }),
      });

      if (!response.ok) {
        return {
          outcome: "failed",
          summary: "Lead greeting failed",
          error: {
            code: "WHATSAPP_TEMPLATE_SEND_FAILED",
            message: await response.text(),
          },
        };
      }

      return {
        outcome: "completed",
        summary: "Lead greeting sent",
        outputs: { sent: true },
      };
    },
  };
}
