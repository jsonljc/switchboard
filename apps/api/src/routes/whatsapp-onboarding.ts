import type { FastifyPluginAsync } from "fastify";

interface OnboardingOptions {
  metaSystemUserToken: string;
  metaSystemUserId: string;
  appSecret: string;
  apiVersion: string;
  webhookBaseUrl: string;
  graphApiFetch: (url: string, init?: RequestInit) => Promise<Record<string, unknown>>;
  createConnection: (data: {
    wabaId: string;
    phoneNumberId: string;
    verifiedName?: string;
    displayPhoneNumber?: string;
  }) => Promise<{ id: string; webhookPath: string }>;
}

export const whatsappOnboardingRoutes: FastifyPluginAsync<OnboardingOptions> = async (
  app,
  opts,
) => {
  const { metaSystemUserToken, metaSystemUserId, apiVersion, webhookBaseUrl } = opts;
  const graphBase = `https://graph.facebook.com/${apiVersion}`;

  async function graphCall(
    path: string,
    method: "GET" | "POST" = "GET",
    body?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const url = `${graphBase}${path}`;
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${metaSystemUserToken}`,
        "Content-Type": "application/json",
      },
    };
    if (body) init.body = JSON.stringify(body);
    return opts.graphApiFetch(url, init);
  }

  app.post<{ Body: { esToken?: string } }>("/whatsapp/onboard", async (request, reply) => {
    if (!request.principalIdFromAuth && process.env.NODE_ENV === "production") {
      return reply.code(401).send({ error: "Authentication required" });
    }

    const { esToken } = request.body ?? {};
    if (!esToken) {
      return reply.code(400).send({ error: "esToken is required" });
    }

    try {
      // 1. Extract WABA ID from debug_token
      const tokenInfo = await graphCall(`/debug_token?input_token=${encodeURIComponent(esToken)}`);
      const data = tokenInfo["data"] as Record<string, unknown>;
      const scopes = data["granular_scopes"] as Array<{
        scope: string;
        target_ids: string[];
      }>;
      const wabaScope = scopes.find((s) => s.scope === "whatsapp_business_management");
      if (!wabaScope?.target_ids?.[0]) {
        return reply.code(400).send({ error: "No WABA found in token scopes" });
      }
      const wabaId = wabaScope.target_ids[0];

      // 2. Add system user to WABA
      await graphCall(
        `/${wabaId}/assigned_users?user=${metaSystemUserId}&tasks=['MANAGE']`,
        "POST",
      );

      // 3. Get phone number ID
      const phoneData = await graphCall(`/${wabaId}/phone_numbers`);
      const phones = phoneData["data"] as Array<{
        id: string;
        verified_name?: string;
        display_phone_number?: string;
      }>;
      if (!phones?.[0]) {
        return reply.code(400).send({ error: "No phone number found for this WABA" });
      }
      const phone = phones[0];

      // 4. Register phone for Cloud API
      await graphCall(`/${phone.id}/register`, "POST", {
        messaging_product: "whatsapp",
        pin: "000000",
      });

      // 5. Create connection and get webhook path
      const connection = await opts.createConnection({
        wabaId,
        phoneNumberId: phone.id,
        verifiedName: phone.verified_name,
        displayPhoneNumber: phone.display_phone_number,
      });

      // 6. Subscribe to webhooks with per-WABA override
      const webhookUrl = `${webhookBaseUrl}${connection.webhookPath}`;
      await graphCall(`/${wabaId}/subscribed_apps`, "POST", {
        override_callback_uri: webhookUrl,
        verify_token: opts.appSecret,
      });

      // 7. Set bot profile
      await graphCall(`/${phone.id}/whatsapp_business_profile`, "POST", {
        messaging_product: "whatsapp",
        automated_type: "3p_full",
      });

      return reply.code(200).send({
        success: true,
        wabaId,
        phoneNumberId: phone.id,
        verifiedName: phone.verified_name,
        displayPhoneNumber: phone.display_phone_number,
        connectionId: connection.id,
      });
    } catch (err) {
      app.log.error(err, "WhatsApp onboarding failed");
      return reply.code(502).send({
        error: "Onboarding failed — could not complete setup with Meta",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  });
};
