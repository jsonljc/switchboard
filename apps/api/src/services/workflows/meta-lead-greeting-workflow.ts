import type { WorkflowHandler } from "@switchboard/core/platform";

export function buildMetaLeadGreetingWorkflow(): WorkflowHandler {
  return {
    async execute(workUnit) {
      const input = workUnit.parameters as {
        phone: string;
        firstName: string;
        templateName: string;
      };

      const accessToken = process.env["WHATSAPP_ACCESS_TOKEN"];
      const phoneNumberId = process.env["WHATSAPP_PHONE_NUMBER_ID"];
      if (!accessToken || !phoneNumberId) {
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
