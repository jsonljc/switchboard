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

export type RegisterPhoneResult =
  | { ok: true }
  | { ok: false; reason: string; pinRequired: boolean };

interface MetaRegisterErrorBody {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
    error_user_title?: string;
    error_user_msg?: string;
  };
}

// WhatsApp Cloud API two-step-verification error codes (133xxx family). Meta's
// reference is JS-rendered and unverifiable from this environment, so this set is
// best-effort; the message heuristic below is the backstop and the route ALWAYS
// surfaces a register failure regardless of classification. Either signal flags a
// PIN-actionable error.
const TWO_STEP_PIN_ERROR_CODES = new Set([133005, 133006, 133008, 133009, 133010]);

function isPinError(err: NonNullable<MetaRegisterErrorBody["error"]>): boolean {
  if (typeof err.code === "number" && TWO_STEP_PIN_ERROR_CODES.has(err.code)) return true;
  const text =
    `${err.message ?? ""} ${err.error_user_title ?? ""} ${err.error_user_msg ?? ""}`.toLowerCase();
  return text.includes("pin") || text.includes("two-step") || text.includes("two step");
}

/**
 * Register a customer phone number for Cloud API.
 *
 * POST /<apiVersion>/<phoneNumberId>/register with { messaging_product, pin }.
 * Meta semantics: with no two-step verification (2SV) the supplied `pin` BECOMES
 * the 2SV PIN; with 2SV already set, `pin` must MATCH the existing PIN. A
 * wrong/missing PIN -> a 2SV error. The route's helperFetch seam forces
 * ok:true/status:200, so Graph errors arrive as a JSON body { error: {...} } -
 * classify on the body, with an HTTP-status fallback for direct fetch callers.
 * `pinRequired` lets the route surface an actionable "enter your existing PIN"
 * message (422) distinct from other registration failures.
 */
export async function registerPhoneNumber(args: {
  apiVersion: string;
  userToken: string;
  phoneNumberId: string;
  pin: string;
  fetchImpl?: typeof fetch;
}): Promise<RegisterPhoneResult> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const url = `https://graph.facebook.com/${args.apiVersion}/${args.phoneNumberId}/register`;
  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${args.userToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", pin: args.pin }),
    });
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "fetch error",
      pinRequired: false,
    };
  }
  let body: MetaRegisterErrorBody;
  try {
    body = (await res.json()) as MetaRegisterErrorBody;
  } catch {
    return res.ok ? { ok: true } : { ok: false, reason: `graph ${res.status}`, pinRequired: false };
  }
  if (body?.error) {
    const e = body.error;
    const reason = e.error_user_msg || e.message || `graph ${e.code ?? "error"}`;
    return { ok: false, reason, pinRequired: isPinError(e) };
  }
  if (!res.ok) return { ok: false, reason: `graph ${res.status}`, pinRequired: false };
  return { ok: true };
}

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

export type ExchangeEsuCodeResult =
  | { ok: true; accessToken: string }
  | { ok: false; reason: string };

/**
 * Exchange a WhatsApp Embedded Signup authorization CODE (returned by the
 * browser ESU JS SDK under `response_type:"code"`) for a business-integration
 * access token.
 *
 * Calls `GET /<apiVersion>/oauth/access_token?client_id&client_secret&code`
 * with NO `redirect_uri`: the code came from the JS SDK, not a redirect flow,
 * so Graph rejects the exchange if a `redirect_uri` is present. That is the key
 * difference from the Ads redirect-OAuth exchanger in `@switchboard/ad-optimizer`
 * (`exchangeCodeForToken`, which DOES send `redirect_uri`).
 *
 * The resulting token is used transiently to introspect the WABA via
 * `debug_token`; the long-lived runtime credential is the central system token
 * (decision D-b), not this exchanged token.
 *
 * @param args.apiVersion - Required Graph API version (e.g. `"v21.0"`).
 */
export async function exchangeEsuCodeForToken(args: {
  apiVersion: string;
  appId: string;
  appSecret: string;
  code: string;
  fetchImpl?: typeof fetch;
}): Promise<ExchangeEsuCodeResult> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const params = new URLSearchParams({
    client_id: args.appId,
    client_secret: args.appSecret,
    code: args.code,
  });
  const url = `https://graph.facebook.com/${args.apiVersion}/oauth/access_token?${params.toString()}`;
  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetchImpl(url);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "fetch error" };
  }
  if (!res.ok) {
    return { ok: false, reason: await readErrorReason(res) };
  }
  let body: { access_token?: string };
  try {
    body = (await res.json()) as { access_token?: string };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "invalid json" };
  }
  if (!body.access_token) {
    return { ok: false, reason: "No access_token in exchange response" };
  }
  return { ok: true, accessToken: body.access_token };
}
