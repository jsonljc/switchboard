import type { FastifyPluginAsync } from "fastify";
import { fetchWabaIdFromToken, registerWebhookOverride } from "../lib/whatsapp-meta.js";

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

  /**
   * Adapter that lets the typed helpers in lib/whatsapp-meta.ts consume the
   * test-injectable `graphApiFetch` (which returns already-parsed JSON, not a
   * Response). We surface success as ok=200; errors propagate via thrown
   * exceptions from `graphApiFetch`, which the helpers catch and convert to
   * `{ ok: false, reason }`. Behavior matches the previous inline code.
   */
  const helperFetch: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const json = await opts.graphApiFetch(url, init);
    return {
      ok: true,
      status: 200,
      json: async () => json,
    } as unknown as Response;
  }) as typeof fetch;

  app.post<{ Body: { esToken?: string } }>("/whatsapp/onboard", async (request, reply) => {
    if (!request.principalIdFromAuth && process.env.NODE_ENV === "production") {
      return reply.code(401).send({ error: "Authentication required" });
    }

    const { esToken } = request.body ?? {};
    if (!esToken) {
      return reply.code(400).send({ error: "esToken is required" });
    }

    try {
      // 1. Extract WABA ID from debug_token.
      // appToken: system app token authorizes the introspection.
      // userToken: the customer's ESU token is the subject being introspected.
      const wabaResult = await fetchWabaIdFromToken({
        apiVersion,
        appToken: metaSystemUserToken,
        userToken: esToken,
        fetchImpl: helperFetch,
      });
      if (!wabaResult.ok) {
        // Distinguish "scope did not contain a WABA" (400 — bad token, surface
        // to caller) from transport/parse errors (502 — bubble to outer
        // catch). The previous inline code only reached the 400 branch when
        // the JSON parsed cleanly and lacked a target_id; transport errors
        // threw out of `graphCall` and were caught by the outer handler.
        if (
          wabaResult.reason === "No WABA found in token scopes" ||
          wabaResult.reason === "No granular_scopes in debug_token response"
        ) {
          return reply.code(400).send({ error: "No WABA found in token scopes" });
        }
        throw new Error(wabaResult.reason);
      }
      const wabaId = wabaResult.wabaId;

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

      // 6. Subscribe to webhooks with per-WABA override.
      // userToken is the system app token here because the ESU exchange just
      // added the system user to the customer's WABA — that's the credential
      // with access. In the standard provision flow (different caller) the
      // customer's decrypted token is passed instead.
      const webhookUrl = `${webhookBaseUrl}${connection.webhookPath}`;
      const overrideResult = await registerWebhookOverride({
        apiVersion,
        userToken: metaSystemUserToken,
        wabaId,
        webhookUrl,
        verifyToken: opts.appSecret,
        fetchImpl: helperFetch,
      });
      if (!overrideResult.ok) {
        throw new Error(`subscribed_apps failed: ${overrideResult.reason}`);
      }

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
