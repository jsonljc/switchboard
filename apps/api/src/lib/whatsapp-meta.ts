/**
 * Meta Graph API helpers for WhatsApp provisioning.
 *
 * ## Token-model contract (locked)
 *
 * Two distinct tokens flow through the WhatsApp provisioning surface:
 *
 * - `appToken`  — the Meta **app** access token (system-level, sourced from
 *                 `WHATSAPP_GRAPH_TOKEN`). It authorizes app-scoped
 *                 introspection calls. Its ONLY legitimate use here is the
 *                 `access_token` query parameter on `/debug_token`.
 *
 * - `userToken` — a **customer-asset** access token. In the standard
 *                 provision flow this is the customer-provided token decrypted
 *                 from `Connection.credentials.token`. In the ESU flow it is
 *                 effectively the system app token because the system user has
 *                 been added to the customer's WABA — the helper does not care
 *                 which it is, the helper takes whatever the caller provides
 *                 and uses it as the credential for the customer-asset call.
 *
 * Endpoint mapping:
 *
 * | Endpoint                          | appToken usage             | userToken usage             |
 * | --------------------------------- | -------------------------- | --------------------------- |
 * | GET /debug_token                  | `access_token` query param | `input_token` query param   |
 * | POST /<wabaId>/subscribed_apps    | (not used)                 | `Authorization: Bearer ...` |
 *
 * The two parameters are intentionally NOT collapsed into a single token.
 * Provision-flow callers MUST pass the customer-decrypted token as `userToken`
 * for `registerWebhookOverride`; passing `appToken` there would silently
 * regress to a credential that has no access to the customer's WABA.
 */

export type FetchWabaIdResult = { ok: true; wabaId: string } | { ok: false; reason: string };

export type RegisterWebhookResult = { ok: true } | { ok: false; reason: string };

interface MetaErrorBody {
  error?: { message?: string };
}

interface DebugTokenBody {
  data?: {
    granular_scopes?: Array<{ scope?: string; target_ids?: string[] }>;
  };
}

async function readErrorReason(res: {
  json: () => Promise<unknown>;
  status: number;
}): Promise<string> {
  try {
    const body = (await res.json()) as MetaErrorBody;
    const msg = body?.error?.message;
    if (msg && typeof msg === "string") return msg;
  } catch {
    // ignore — fall through to status-only reason
  }
  return `graph ${res.status}`;
}

/**
 * Introspect a customer-asset Meta token to extract the WABA id it grants
 * access to.
 *
 * Calls `GET /<apiVersion>/debug_token?input_token=<userToken>&access_token=<appToken>`.
 * The `appToken` (system app access token) authorizes the call; the
 * `userToken` is the subject of the introspection.
 *
 * @param args.apiVersion - Required Graph API version (e.g. `"v17.0"`). The
 *   helper does not provide a default; callers SHOULD source this from a
 *   single config point (env or app config) so all Meta calls use the same
 *   version.
 */
export async function fetchWabaIdFromToken(args: {
  apiVersion: string;
  appToken: string;
  userToken: string;
  fetchImpl?: typeof fetch;
}): Promise<FetchWabaIdResult> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const url = `https://graph.facebook.com/${args.apiVersion}/debug_token?input_token=${encodeURIComponent(args.userToken)}&access_token=${encodeURIComponent(args.appToken)}`;
  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetchImpl(url);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "fetch error" };
  }
  if (!res.ok) {
    return { ok: false, reason: await readErrorReason(res) };
  }
  let body: DebugTokenBody;
  try {
    body = (await res.json()) as DebugTokenBody;
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "invalid json" };
  }
  const scopes = body?.data?.granular_scopes;
  if (!Array.isArray(scopes) || scopes.length === 0) {
    return { ok: false, reason: "No granular_scopes in debug_token response" };
  }
  // Mirror the extraction logic in apps/api/src/routes/whatsapp-onboarding.ts:
  // prefer the whatsapp_business_management scope's first target id.
  const wabaScope = scopes.find((s) => s?.scope === "whatsapp_business_management");
  const wabaId = wabaScope?.target_ids?.[0];
  if (!wabaId) {
    return { ok: false, reason: "No WABA found in token scopes" };
  }
  return { ok: true, wabaId };
}

/**
 * Register a per-WABA webhook override URL with Meta.
 *
 * Calls `POST /<apiVersion>/<wabaId>/subscribed_apps` with
 * `Authorization: Bearer <userToken>`. The `userToken` MUST be a token with
 * access to the WABA — typically the customer's decrypted token in the
 * standard provision flow.
 *
 * @param args.apiVersion - Required Graph API version (e.g. `"v17.0"`). The
 *   helper does not provide a default; callers SHOULD source this from a
 *   single config point (env or app config) so all Meta calls use the same
 *   version.
 */
export async function registerWebhookOverride(args: {
  apiVersion: string;
  userToken: string;
  wabaId: string;
  webhookUrl: string;
  verifyToken: string;
  fetchImpl?: typeof fetch;
}): Promise<RegisterWebhookResult> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const url = `https://graph.facebook.com/${args.apiVersion}/${args.wabaId}/subscribed_apps`;
  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.userToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        override_callback_uri: args.webhookUrl,
        verify_token: args.verifyToken,
      }),
    });
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "fetch error" };
  }
  if (!res.ok) {
    return { ok: false, reason: await readErrorReason(res) };
  }
  return { ok: true };
}
