import type { WorkflowHandler } from "@switchboard/core/platform";
import {
  evaluateProactiveSendEligibility,
  formatReminderDateTime,
  type TemplateApprovalOverlay,
} from "@switchboard/core";
import type { IntentClass, PdpaJurisdiction } from "@switchboard/schemas";

const REMINDER_INTENT_CLASS: IntentClass = "appointment-reminder";

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

      const accessToken = process.env["WHATSAPP_ACCESS_TOKEN"];
      const phoneNumberId = process.env["WHATSAPP_PHONE_NUMBER_ID"];
      if (!accessToken || !phoneNumberId) {
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
