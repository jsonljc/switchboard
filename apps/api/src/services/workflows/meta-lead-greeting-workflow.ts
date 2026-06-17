import type { WorkflowHandler } from "@switchboard/core/platform";
import { getMetrics } from "@switchboard/core";
import { resolveWhatsAppSendToken } from "../../lib/whatsapp-send-token.js";

const GREETING_INTENT = "meta.lead.greeting.send";

export function buildMetaLeadGreetingWorkflow(): WorkflowHandler {
  return {
    async execute(workUnit) {
      const input = workUnit.parameters as {
        phone: string;
        firstName: string;
        templateName: string;
      };

      const accessToken = resolveWhatsAppSendToken();
      const phoneNumberId = process.env["WHATSAPP_PHONE_NUMBER_ID"];
      if (!accessToken || !phoneNumberId) {
        // Infra config gap, not a per-contact decision: with no send token/phone id
        // EVERY lead greeting silently no-ops. Make it loud + countable (distinct from
        // benign per-contact skips) so the dark funnel is visible.
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
          outputs: {},
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
          to: input.phone,
          type: "template",
          template: {
            name: input.templateName,
            language: { code: "en" },
            components: [
              {
                type: "body",
                parameters: [{ type: "text", text: input.firstName }],
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

      return { outcome: "completed", summary: "Lead greeting sent", outputs: {} };
    },
  };
}
