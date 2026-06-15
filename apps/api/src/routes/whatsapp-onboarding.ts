// @route-class: ingress-receiver
import type { FastifyPluginAsync } from "fastify";
import {
  fetchWabaIdFromToken,
  registerWebhookOverride,
  exchangeEsuCodeForToken,
  registerPhoneNumber,
} from "../lib/whatsapp-meta.js";
import { notifyChatProvisionedChannel } from "../lib/notify-chat-provisioned-channel.js";
import { resolveOrganizationForMutation } from "../utils/org-access.js";

type OnboardBody = { esToken?: string; code?: string; organizationId?: string; pin?: string };

interface OnboardingOptions {
  metaSystemUserToken: string;
  metaSystemUserId: string;
  appSecret: string;
  /** Meta app id (client_id) for the ESU `code` -> token exchange. Optional so
   *  the legacy `esToken` path and existing tests keep working without it. */
  appId?: string;
  apiVersion: string;
  webhookBaseUrl: string;
  /**
   * Chat runtime base URL for the provision-notify call. Optional so existing
   * callers (and tests) keep working; when missing, the helper surfaces a
   * `config_error` and the route reports `chatRegistration: "config_error"`.
   * Plumbed via opts (not read from process.env) to match the existing
   * `webhookBaseUrl` pattern in this route.
   */
  chatPublicUrl?: string;
  /** Internal API shared secret for provision-notify. Same opt-injection pattern. */
  internalApiSecret?: string;
  /** Test seam for the notify helper's fetch. Defaults to global fetch. */
  notifyFetch?: typeof fetch;
  graphApiFetch: (url: string, init?: RequestInit) => Promise<Record<string, unknown>>;
  createConnection: (data: {
    wabaId: string;
    phoneNumberId: string;
    verifiedName?: string;
    displayPhoneNumber?: string;
    /** Authenticated operator org — never "" (resolved upstream; 403 without a binding). */
    organizationId: string;
    /** Bearer the runtime adapter sends with (D-b: the central system token). */
    runtimeToken: string;
    /** Webhook GET-handshake token; equals the value registered via subscribed_apps. */
    verifyToken: string;
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

  app.post<{ Body: OnboardBody }>("/whatsapp/onboard", async (request, reply) => {
    if (!request.principalIdFromAuth && process.env.NODE_ENV === "production") {
      return reply.code(401).send({ error: "Authentication required" });
    }

    const { esToken, code, pin } = request.body ?? {};
    if (!esToken && !code) {
      return reply.code(400).send({ error: "code or esToken is required" });
    }

    // Org-scope the connection to the authenticated operator. In prod this is
    // the Bearer's org (403 without a binding); in dev the request body's org.
    // Fixes the persisted `organizationId: ""` — the row had no tenant owner.
    const organizationId = resolveOrganizationForMutation(
      request,
      reply,
      request.body?.organizationId,
    );
    if (organizationId === null) return;

    // The webhook verify token MUST be identical at registration
    // (subscribed_apps) and at storage (creds.verifyToken), or the inbound GET
    // handshake 403s. Single source so the two cannot drift.
    const verifyToken = opts.appSecret;

    try {
      // Resolve the token used to introspect the WABA. Prefer the ESU OAuth
      // `code` (exchanged server-side with the app secret, NO redirect_uri); fall
      // back to a pre-exchanged `esToken` (legacy / direct).
      let userToken: string;
      if (code) {
        if (!opts.appId) {
          return reply
            .code(500)
            .send({ error: "Server is missing META_APP_ID for the ESU code exchange" });
        }
        const exchanged = await exchangeEsuCodeForToken({
          apiVersion,
          appId: opts.appId,
          appSecret: opts.appSecret,
          code,
          fetchImpl: helperFetch,
        });
        if (!exchanged.ok) {
          return reply
            .code(502)
            .send({ error: "Failed to exchange code for token", detail: exchanged.reason });
        }
        userToken = exchanged.accessToken;
      } else {
        // esToken is guaranteed present here (the !esToken && !code check 400'd).
        userToken = esToken as string;
      }

      // 1. Extract WABA ID from debug_token.
      // appToken: system app token authorizes the introspection.
      // userToken: the ESU token (exchanged from `code`, or the direct esToken).
      const wabaResult = await fetchWabaIdFromToken({
        apiVersion,
        appToken: metaSystemUserToken,
        userToken,
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

      // 2. Add system user to WABA. tasks MUST be a URL-encoded JSON array
      // (["MANAGE"]); a single-quote literal ['MANAGE'] is invalid JSON and Graph
      // rejects or misparses it.
      const assignedTasks = encodeURIComponent(JSON.stringify(["MANAGE"]));
      await graphCall(
        `/${wabaId}/assigned_users?user=${metaSystemUserId}&tasks=${assignedTasks}`,
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

      // 4. Register phone for Cloud API. Meta semantics: with no two-step
      // verification (2SV) the supplied pin BECOMES the 2SV pin; with 2SV
      // already set it must MATCH. Operators with an existing 2SV PIN pass it via
      // the ESU flow; absent -> "000000" (unchanged for fresh numbers). A failure
      // used to be swallowed (graphApiFetch ignores HTTP status, the result was
      // discarded) -> phantom 200. Surface it instead, before persisting anything.
      const registerResult = await registerPhoneNumber({
        apiVersion,
        userToken: metaSystemUserToken,
        phoneNumberId: phone.id,
        pin: pin || "000000",
        fetchImpl: helperFetch,
      });
      if (!registerResult.ok) {
        if (registerResult.pinRequired) {
          return reply.code(422).send({
            error:
              "This WhatsApp number has two-step verification enabled. Enter its existing 6-digit PIN and try again. If you don't know it, reset it in WhatsApp Manager.",
            code: "whatsapp_registration_pin_required",
            detail: registerResult.reason,
          });
        }
        return reply.code(502).send({
          error: "Phone registration failed. We could not register the number with WhatsApp.",
          detail: registerResult.reason,
        });
      }

      // 5. Create connection and get webhook path
      const connection = await opts.createConnection({
        wabaId,
        phoneNumberId: phone.id,
        verifiedName: phone.verified_name,
        displayPhoneNumber: phone.display_phone_number,
        organizationId,
        // D-b: the runtime sends on the central system token (already the
        // credential for every Graph call in this route), not a per-tenant token.
        runtimeToken: metaSystemUserToken,
        verifyToken,
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
        verifyToken,
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

      // 8. Notify the chat runtime that a managed channel was provisioned.
      // Task 8.5: a channel must never be considered successfully provisioned
      // without the chat runtime being notified (or the failure surfaced
      // explicitly). Response shape stays additive — `success: true` is
      // preserved for backward compatibility; `chatRegistration` is the new
      // truthy signal callers should branch on.
      const notifyResult = await notifyChatProvisionedChannel({
        managedChannelId: connection.id,
        chatPublicUrl: opts.chatPublicUrl,
        internalApiSecret: opts.internalApiSecret,
        fetchImpl: opts.notifyFetch,
      });

      return reply.code(200).send({
        success: true,
        wabaId,
        phoneNumberId: phone.id,
        verifiedName: phone.verified_name,
        displayPhoneNumber: phone.display_phone_number,
        connectionId: connection.id,
        chatRegistration:
          notifyResult.kind === "ok"
            ? "active"
            : notifyResult.kind === "config_error"
              ? "config_error"
              : "pending_chat_register",
        chatRegistrationDetail: notifyResult.kind === "ok" ? null : notifyResult.reason,
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
