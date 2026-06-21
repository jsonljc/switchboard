import type { WorkflowHandler } from "@switchboard/core/platform";
import {
  evaluateProactiveSendEligibility,
  formatReminderDateTime,
  type TemplateApprovalOverlay,
} from "@switchboard/core";
import type { IntentClass, PdpaJurisdiction } from "@switchboard/schemas";

const REMINDER_INTENT_CLASS: IntentClass = "appointment-reminder";

// Send-reliability additions are kept off the shared "@switchboard/core" import
// line above (and off its 3-line context window) so they never collide with a
// sibling change that also widens that import — e.g. the template-approval-overlay
// work adds `type TemplateApprovalOverlay` to the very same line.
import { getMetrics } from "@switchboard/core";
import { resolveWhatsAppSendToken } from "../../lib/whatsapp-send-token.js";

const REMINDER_INTENT = "conversation.reminder.send";

export interface ReminderSendContext {
  consentGrantedAt: Date | string | null;
  consentRevokedAt: Date | string | null;
  pdpaJurisdiction: PdpaJurisdiction | null;
  messagingOptIn: boolean;
  lastWhatsAppInboundAt: Date | null;
  jurisdiction: "SG" | "MY" | null;
  leadName: string;
  businessName: string;
  phone: string | null;
  /**
   * Org-resolvable WhatsApp template-approval source (metaTemplateName -> status).
   * Sourced by the per-org read inside getSendContext; lets a Meta-APPROVED template
   * actually send. Omitted/empty → the static registry default (draft) keeps the send
   * blocked.
   */
  approvalOverlay?: TemplateApprovalOverlay;
}

export interface ConversationReminderSendDeps {
  getSendContext: (orgId: string, contactId: string) => Promise<ReminderSendContext>;
  allowMarketingTemplate: boolean;
  selectTemplateFn?: Parameters<typeof evaluateProactiveSendEligibility>[0]["selectTemplateFn"];
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

interface ReminderSendParams {
  contactId: string;
  bookingId: string;
  startsAt: string;
  timezone: string;
  channel: string;
  reminderId: string;
}

export function buildConversationReminderSendWorkflow(
  deps: ConversationReminderSendDeps,
): WorkflowHandler {
  const resolveOrgSendCreds = deps.resolveOrgSendCreds ?? (async () => null);
  return {
    async execute(workUnit, _services) {
      const params = workUnit.parameters as unknown as ReminderSendParams;

      if (params.channel !== "whatsapp") {
        return {
          outcome: "completed",
          summary: "Reminder skipped: unsupported channel",
          outputs: { sent: false, skipReason: "unsupported_channel" },
        };
      }

      const ctx = await deps.getSendContext(workUnit.organizationId, params.contactId);

      const eligibility = evaluateProactiveSendEligibility({
        contact: {
          pdpaJurisdiction: ctx.pdpaJurisdiction,
          consentGrantedAt: ctx.consentGrantedAt,
          consentRevokedAt: ctx.consentRevokedAt,
          messagingOptIn: ctx.messagingOptIn,
        },
        lastWhatsAppInboundAt: ctx.lastWhatsAppInboundAt,
        intentClass: REMINDER_INTENT_CLASS,
        jurisdiction: ctx.jurisdiction,
        allowMarketingTemplate: deps.allowMarketingTemplate,
        selectTemplateFn: deps.selectTemplateFn,
        approvalOverlay: ctx.approvalOverlay,
      });

      if (!eligibility.eligible) {
        return {
          outcome: "completed",
          summary: `Reminder skipped: ${eligibility.reason}`,
          outputs: { sent: false, skipReason: eligibility.reason },
        };
      }

      if (!ctx.phone) {
        // Single-attempt: record a clean skip rather than a retryable failure.
        return {
          outcome: "completed",
          summary: "Reminder skipped: contact has no phone",
          outputs: { sent: false, skipReason: "missing_contact_phone" },
        };
      }

      // Multi-tenant: prefer the sending org's own send creds; PER-FIELD fall back
      // to the global env values (single-tenant pilot) so a partial per-org row
      // never dark-holes the deployment-wide config.
      const perOrg = await resolveOrgSendCreds(workUnit.organizationId);
      const accessToken = perOrg?.token ?? resolveWhatsAppSendToken();
      const phoneNumberId = perOrg?.phoneNumberId ?? process.env["WHATSAPP_PHONE_NUMBER_ID"];
      if (!accessToken || !phoneNumberId) {
        // Infra config gap, not a per-contact decision: with no send token/phone id
        // EVERY reminder for the deployment silently no-ops. Make it loud + countable
        // (distinct from the benign per-contact skips above) so the dark funnel is visible.
        console.warn(
          "[conversation.reminder.send] WhatsApp send token or phone id missing " +
            "(set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID); reminder skipped org-wide.",
        );
        getMetrics().whatsappProactiveSendSkipped.inc({
          intent: REMINDER_INTENT,
          reason: "config_missing",
        });
        return {
          outcome: "completed",
          summary: "WhatsApp not configured; reminder skipped",
          outputs: { sent: false, skipReason: "unsupported_channel" },
        };
      }

      const { date, time } = formatReminderDateTime(new Date(params.startsAt), params.timezone);

      const response = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: ctx.phone,
          type: "template",
          template: {
            name: eligibility.template.metaTemplateName,
            language: { code: "en" },
            components: [
              {
                type: "body",
                parameters: [
                  { type: "text", text: ctx.leadName },
                  { type: "text", text: ctx.businessName },
                  { type: "text", text: date },
                  { type: "text", text: time },
                ],
              },
            ],
          },
        }),
      });

      if (!response.ok) {
        return {
          outcome: "failed",
          summary: "Reminder send failed",
          error: {
            code: "WHATSAPP_TEMPLATE_SEND_FAILED",
            message: await response.text(),
          },
        };
      }

      const json = (await response.json()) as { messages?: Array<{ id?: string }> };
      return {
        outcome: "completed",
        summary: "Reminder sent",
        outputs: { sent: true, messageId: json.messages?.[0]?.id ?? null },
      };
    },
  };
}
