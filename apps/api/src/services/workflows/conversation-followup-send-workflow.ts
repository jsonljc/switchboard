import type { WorkflowHandler } from "@switchboard/core/platform";
import { evaluateProactiveSendEligibility, type TemplateApprovalOverlay } from "@switchboard/core";
import type { IntentClass, PdpaJurisdiction } from "@switchboard/schemas";

export interface FollowUpSendContext {
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

export interface ConversationFollowUpSendDeps {
  getSendContext: (
    orgId: string,
    contactId: string,
    threadId: string | null,
  ) => Promise<FollowUpSendContext>;
  allowMarketingTemplate: boolean;
  selectTemplateFn?: Parameters<typeof evaluateProactiveSendEligibility>[0]["selectTemplateFn"];
}

interface FollowUpSendParams {
  contactId: string;
  conversationThreadId: string | null;
  channel: string;
  templateIntentClass: IntentClass;
  reason: string;
  followUpId: string;
}

// Send-reliability additions are kept off the shared "@switchboard/core" import line
// at the top of the file (and off its 3-line context window) so they never collide
// with a sibling change that also widens that same import — e.g. the
// template-approval-overlay work adds `type TemplateApprovalOverlay` to that line.
import { getMetrics } from "@switchboard/core";
import { resolveWhatsAppSendToken } from "../../lib/whatsapp-send-token.js";

const FOLLOWUP_INTENT = "conversation.followup.send";

export function buildConversationFollowUpSendWorkflow(
  deps: ConversationFollowUpSendDeps,
): WorkflowHandler {
  return {
    async execute(workUnit) {
      const params = workUnit.parameters as unknown as FollowUpSendParams;

      if (params.channel !== "whatsapp") {
        return {
          outcome: "completed",
          summary: "Follow-up skipped: unsupported channel",
          outputs: { sent: false, skipReason: "unsupported_channel" },
        };
      }

      const ctx = await deps.getSendContext(
        workUnit.organizationId,
        params.contactId,
        params.conversationThreadId,
      );

      const eligibility = evaluateProactiveSendEligibility({
        contact: {
          pdpaJurisdiction: ctx.pdpaJurisdiction,
          consentGrantedAt: ctx.consentGrantedAt,
          consentRevokedAt: ctx.consentRevokedAt,
          messagingOptIn: ctx.messagingOptIn,
        },
        lastWhatsAppInboundAt: ctx.lastWhatsAppInboundAt,
        intentClass: params.templateIntentClass,
        jurisdiction: ctx.jurisdiction,
        allowMarketingTemplate: deps.allowMarketingTemplate,
        selectTemplateFn: deps.selectTemplateFn,
        approvalOverlay: ctx.approvalOverlay,
      });

      if (!eligibility.eligible) {
        return {
          outcome: "completed",
          summary: `Follow-up skipped: ${eligibility.reason}`,
          outputs: { sent: false, skipReason: eligibility.reason },
        };
      }

      if (!ctx.phone) {
        return {
          outcome: "failed",
          summary: "Follow-up send failed: contact has no phone",
          error: { code: "MISSING_CONTACT_PHONE", message: "No phone number for contact" },
        };
      }

      const accessToken = resolveWhatsAppSendToken();
      const phoneNumberId = process.env["WHATSAPP_PHONE_NUMBER_ID"];
      if (!accessToken || !phoneNumberId) {
        // Infra config gap, not a per-contact decision: with no send token/phone id
        // EVERY follow-up for the deployment silently no-ops. Make it loud + countable
        // (distinct from the benign per-contact skips above) so the dark funnel is visible.
        console.warn(
          "[conversation.followup.send] WhatsApp send token or phone id missing " +
            "(set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID); follow-up skipped org-wide.",
        );
        getMetrics().whatsappProactiveSendSkipped.inc({
          intent: FOLLOWUP_INTENT,
          reason: "config_missing",
        });
        return {
          outcome: "completed",
          summary: "WhatsApp not configured; follow-up skipped",
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
                ],
              },
            ],
          },
        }),
      });

      if (!response.ok) {
        return {
          outcome: "failed",
          summary: "Follow-up send failed",
          error: {
            code: "WHATSAPP_TEMPLATE_SEND_FAILED",
            message: await response.text(),
          },
        };
      }

      const json = (await response.json()) as { messages?: Array<{ id?: string }> };
      return {
        outcome: "completed",
        summary: "Follow-up sent",
        outputs: { sent: true, messageId: json.messages?.[0]?.id ?? null },
      };
    },
  };
}
