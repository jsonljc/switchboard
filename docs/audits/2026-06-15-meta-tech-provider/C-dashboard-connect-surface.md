# C — Dashboard Connect Surface (Meta App Review recordability)

**Date:** 2026-06-15
**Scope:** `apps/dashboard` click-through surface + full route chain to the API, for (a) WhatsApp Embedded Signup and (b) Meta Ads / Facebook connect.
**Method:** READ-ONLY. Every claim cites `file:line`.

**Bottom line:** **NO** — we cannot record a clean, logged-in user clicking Connect → Meta popup → "Connected" today, on _either_ flow, without env + code fixes. The FB JS SDK loads and is gated _correctly_ (static env read, CSP allows the script host), and the settings page is reachable, so the **first half is real**. But each flow has a hard break in the back half: the WhatsApp ES component reads the wrong field off the SDK response (`accessToken` while configured for `response_type:"code"`) and has no `message` listener, and the Meta Ads OAuth button calls `getUrl()` with no `deploymentId` (→ API 400) and its success callback redirects to a `/connections/callback` page that **does not exist** (→ 404). Details below.

---

## 1. Reachability (where a logged-in user lands)

- Settings hub: `apps/dashboard/src/app/(auth)/settings/page.tsx:14-18` renders a "Channels" shortcut card → `/settings/channels`. No flag, no entitlement, no demo branch. Renders for any authed org.
- Channels page: `apps/dashboard/src/app/(auth)/settings/channels/page.tsx:22-23` renders `<ConnectionsList />` and `<ChannelManagement />`. Client component; redirects to `/login` if unauthenticated (`page.tsx:11`).
- WhatsApp management page: `apps/dashboard/src/app/(auth)/settings/channels/whatsapp/page.tsx:32` renders `<WhatsAppManagement />` (read-only status/templates surface, not the connect button).
- Auth gating: middleware `apps/dashboard/src/middleware.ts:21-31` lists `/settings` in `AUTH_PAGE_PREFIXES`; matcher includes `/settings/:path*` (`middleware.ts:163`). Without a session cookie → redirect `/login` (`middleware.ts:145-151`). `DEV_BYPASS_AUTH` short-circuits (`middleware.ts:141-143`).
- **Verdict: reachable.** A normal authed org reaches `/settings/channels` and sees the "New Connection" dialog. No demo-mode or entitlement gate on the connect controls.

---

## 2. FB JS SDK gating verdict (static vs dynamic env read)

**STATIC reads — the button is live in a real browser when env is set.** This is the good case (the failure mode flagged in MEMORY `feedback_next_public_dynamic_env_not_inlined` does NOT apply here).

- `apps/dashboard/src/components/settings/meta-sdk-script.tsx:17` — `const appId = process.env.NEXT_PUBLIC_META_APP_ID;` — static member access; Next inlines it client-side. Returns `null` if unset (`meta-sdk-script.tsx:18`), so the `<Script>` never mounts without the env.
- `apps/dashboard/src/components/settings/connections-list.tsx:346` — `serviceId === "whatsapp" && process.env.NEXT_PUBLIC_META_APP_ID` — static; gates whether the ES card renders at all.
- `connections-list.tsx:349-350` — passes `process.env.NEXT_PUBLIC_META_APP_ID` and `process.env.NEXT_PUBLIC_META_CONFIG_ID ?? ""` as props — both static.
- No bracket/dynamic `process.env[...]` reads of these vars anywhere in `apps/dashboard/src` (grep confirmed; only the two files above + the SDK loader).
- SDK injection: `meta-sdk-script.tsx:20-34` renders `next/script` `src="https://connect.facebook.net/en_US/sdk.js"`, `strategy="lazyOnload"`, and `FB.init({ appId, version: "v21.0" })` on load. Mounted ONLY by the authed layout, behind a real session: `apps/dashboard/src/app/(auth)/layout.tsx:25` — `{session && <MetaSdkScript />}`.

**CSP:** `apps/dashboard/next.config.mjs:18` — `script-src 'self' 'unsafe-inline' https://connect.facebook.net` → the SDK script loads. **BUT** `next.config.mjs:5` sets `X-Frame-Options: DENY`, `:21` sets `frame-ancestors 'none'`, and there is **no `frame-src` directive** (CSP default-src `'self'` at `:11` then governs frames). FB.login's OAuth dialog opens as a popup window (top-level, not framed) so it is _probably_ not blocked by X-Frame-Options/frame-ancestors (those constrain who may frame _us_, and the popup is its own top-level document). However, the WhatsApp Embedded Signup overlay/iframe path and any `xfbml`-rendered FB iframe **would** be blocked by the missing `frame-src` allowance for `https://www.facebook.com`. Flag: add `frame-src https://www.facebook.com https://web.facebook.com` before relying on any framed Meta UI; verify the live popup in a real browser network panel (the in-repo CSP test `apps/dashboard/src/app/__tests__/meta-sdk-surface.test.ts:58-66` only asserts the script-src host, not frame-src).

**Verdict: SDK gating is correct (static). Button is live in-browser IF `NEXT_PUBLIC_META_APP_ID` is set at build time.** CSP allows the script; frame allowances are missing for any framed Meta UI.

---

## 3. WhatsApp Embedded Signup — click-path (hop by hop)

| #   | Hop                                                                                       | file:line                                                        | Status                                         |
| --- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------- |
| 1   | Settings hub → Channels link                                                              | `app/(auth)/settings/page.tsx:14-18`                             | wired                                          |
| 2   | Channels page renders ConnectionsList                                                     | `app/(auth)/settings/channels/page.tsx:22`                       | wired                                          |
| 3   | "New Connection" → dialog → select service "whatsapp"                                     | `connections-list.tsx:139,291-296`                               | wired                                          |
| 4   | ES card renders (gated on `NEXT_PUBLIC_META_APP_ID`)                                      | `connections-list.tsx:346-360`                                   | **flag-gated** (env)                           |
| 5   | FB SDK loaded + `window.FB` init                                                          | `(auth)/layout.tsx:25` → `meta-sdk-script.tsx:20-34`             | wired (needs env)                              |
| 6   | "Connect WhatsApp" → `handleConnect`                                                      | `whatsapp-embedded-signup.tsx:24,109-110`                        | wired                                          |
| 7   | `window.FB.login({config_id, response_type:"code", override_default_response_type:true})` | `whatsapp-embedded-signup.tsx:34,72-80`                          | wired (needs `NEXT_PUBLIC_META_CONFIG_ID`)     |
| 8   | Callback reads `response.authResponse?.accessToken`                                       | `whatsapp-embedded-signup.tsx:36`                                | **BROKEN — wrong field**                       |
| 8b  | No `message`/`postMessage` listener for ES session info                                   | `whatsapp-embedded-signup.tsx` (absent)                          | **MISSING**                                    |
| 9   | POST `/api/dashboard/connections/whatsapp-embedded` `{esToken: accessToken}`              | `whatsapp-embedded-signup.tsx:44-48`                             | wired                                          |
| 10  | Next route → forwards to API `/whatsapp/onboard`                                          | `app/api/dashboard/connections/whatsapp-embedded/route.ts:10-17` | wired (thin proxy)                             |
| 11  | API onboard: introspect token, register WABA, create connection                           | `apps/api/src/routes/whatsapp-onboarding.ts:74-201`              | wired (needs system env)                       |
| 12  | Connection persisted                                                                      | `apps/api/src/bootstrap/routes.ts:197-217`                       | **wired but org-blind** (`organizationId: ""`) |
| 13  | Success UI: "WhatsApp Connected" + verifiedName/phone                                     | `whatsapp-embedded-signup.tsx:52-62,87-96`                       | wired (only fires if data.success)             |

**Primary break — hop 8 (`whatsapp-embedded-signup.tsx:36`):** the SDK is invoked with `response_type: "code"` + `override_default_response_type: true` (`:74-75`), which is Meta's WhatsApp Embedded Signup token-exchange mode. In that mode the callback's `authResponse` carries a **`code`** (and the WABA/phone IDs arrive via a `window` `message` event, gated by `sessionInfoVersion: "2"` at `:78`). The component instead reads `response.authResponse?.accessToken` (`:36`). Under `response_type:"code"` that field is **undefined**, so the guard at `:36-39` sets status back to `"idle"` and returns silently — **the user clicks Connect, the Meta dialog completes, and nothing happens** (no POST, no error, no success). The `accessToken` field is only populated under the default `response_type:"token"`; the code here explicitly overrides to `"code"`. So either the SDK config or the response-reading is wrong. As written, the happy path cannot reach hop 9.

**Even if hop 8 read `code`:** the downstream contract is an **access token**, not a code. `route.ts:13` posts the body straight to `/whatsapp/onboard`, which feeds `esToken` into `fetchWabaIdFromToken(... userToken: esToken ...)` (`whatsapp-onboarding.ts:88-93`), which calls `GET /debug_token?input_token=<userToken>` (`apps/api/src/lib/whatsapp-meta.ts:82`). `debug_token` introspects an **access token**, not an OAuth code. The locked token-model doc-block (`whatsapp-meta.ts:4-32`) states `userToken` must be a "customer-asset access token." So the component would need to either (a) use `response_type:"token"` and forward the real access token, or (b) capture the ES `message` payload (waba_id/phone_number_id) and exchange the `code` server-side for a token. Neither exists today. **This is a genuine "looks wired but inert" — the whole back half is plumbed and tested at the API layer, but the browser leg never produces the input the API expects.**

**Secondary issue — hop 12 (`apps/api/src/bootstrap/routes.ts:207`):** `createConnection` writes `organizationId: ""`. The `/whatsapp/onboard` route never resolves the caller's org (`whatsapp-onboarding.ts:74-76` only checks `principalIdFromAuth` exists in production; it does not read/scope an org). So a "successful" ES onboard would create a WhatsApp `Connection` with an empty org id — not attributable to the operator's tenant, and not what `useConnections()`/the WA management surface scope their reads to. For a single-tenant recording demo this may _appear_ to work if reads aren't org-filtered, but it is incorrect and would not show under a tenant-scoped connections list.

**Env required for this flow (all documented in `.env.example:133-146`):** `NEXT_PUBLIC_META_APP_ID` + `NEXT_PUBLIC_META_CONFIG_ID` (dashboard, build-time) and `META_SYSTEM_USER_TOKEN`, `META_SYSTEM_USER_ID`, `META_APP_SECRET`, `CHAT_PUBLIC_URL` (API; `apps/api/src/bootstrap/routes.ts:186-191`). All default to `""` → onboard would 502 from Meta if unset.

---

## 4. Meta Ads / Facebook connect — click-path (hop by hop)

| #   | Hop                                                                                           | file:line                                                                             | Status                                          |
| --- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 1   | "New Connection" dialog → select service "meta-ads"                                           | `connections-list.tsx:36,291-296`                                                     | wired                                           |
| 2   | OAuth button renders (config has `.oauth`)                                                    | `connections-list.tsx:326-337`; `service-field-configs.ts:47-52`                      | wired                                           |
| 3   | Click → `getUrl()` called with **no arg** → `deploymentId` undefined                          | `connections-list.tsx:332`                                                            | **BROKEN — missing deploymentId**               |
| 4   | `window.location.href = "/api/dashboard/connections/facebook/authorize"` (no `?deploymentId`) | `service-field-configs.ts:49-50`                                                      | wired                                           |
| 5   | Next authorize route requires `deploymentId` → **400**                                        | `app/api/dashboard/connections/facebook/authorize/route.ts:8-10`                      | **dead-ends (400)**                             |
| 5b  | (if id present) proxy → `client.getFacebookAuthorizeUrl(id)`                                  | `authorize/route.ts:15-17`; `api-client/marketplace.ts:142-146`                       | wired                                           |
| 6   | API `/api/connections/facebook/authorize` mints signed URL                                    | `apps/api/src/routes/facebook-oauth.ts:31-73`                                         | wired                                           |
| 7   | Browser redirected to Meta consent                                                            | `facebook-oauth.ts:67`                                                                | wired                                           |
| 8   | Meta → `/api/connections/facebook/callback` (API, auth-exempt)                                | `apps/api/src/routes/facebook-oauth.ts:84-182`; `apps/api/src/middleware/auth.ts:147` | wired                                           |
| 9   | Callback exchanges code, lists ad accounts, stores connection                                 | `facebook-oauth.ts:130-167`                                                           | wired (needs `META_APP_ID/SECRET/REDIRECT_URI`) |
| 10  | Callback redirects to `${DASHBOARD_URL}/connections/callback?connected=true`                  | `facebook-oauth.ts:169-172`                                                           | **BROKEN — target page 404**                    |
| 11  | Success-state UI / "Connected" landing                                                        | (no `/connections/callback` page exists)                                              | **MISSING**                                     |

**Primary break — hop 3 (`connections-list.tsx:332`):** `const url = SERVICE_CONNECTION_CONFIGS[serviceId].oauth!.getUrl();` — called with **no `deploymentId`**. `getUrl` only appends the query when an arg is passed (`service-field-configs.ts:49-50`), so the browser navigates to `/api/dashboard/connections/facebook/authorize` with no query. The Next route returns **400 `{error: "deploymentId is required"}`** (`authorize/route.ts:8-10`), and the API leg would too (`facebook-oauth.ts:43-47`). **The "Connect with Meta" button dead-ends on a 400 JSON page.** The UI has no notion of "which deployment" at this point — `ConnectionsList` is a flat org-level connection manager with no deployment context, while the entire Facebook OAuth chain is deployment-scoped by design (org-ownership gate at `facebook-oauth.ts:55-61`). There is a model mismatch: the only correct caller of `getFacebookAuthorizeUrl` is a deployment-scoped surface, not this generic dialog.

**Secondary break — hop 10/11 (`facebook-oauth.ts:171`):** even a fully-configured, successful OAuth round-trip redirects the browser to `${DASHBOARD_URL}/connections/callback?connected=true&deploymentId=...`. **No such page exists** — `apps/dashboard/src/app/` has only `api/dashboard/connections/facebook/authorize/` under `connections`; there is no `app/(auth)/connections/callback/page.tsx` (or any `connections/callback` route). The user would land on a Next 404 after granting consent. There is no "Connected" success screen for the Meta Ads OAuth flow at all.

**Manual fallback exists and works for credentials (not for recording an OAuth flow):** the same dialog lets an operator paste a System User token + Ad Account ID (`service-field-configs.ts:20-46`) and `POST` via `useCreateConnection`. That persists a `meta-ads` connection but is _not_ the OAuth/permission click-through Meta App Review wants to see on video.

**Env required for OAuth:** `META_APP_ID`, `META_APP_SECRET`, `META_OAUTH_REDIRECT_URI` (or `FACEBOOK_*` aliases) — `apps/api/src/utils/meta-oauth-config.ts:15-31` throws if absent; `DASHBOARD_URL` for the callback redirect (`facebook-oauth.ts:169`). All documented (`.env.example:134-141,326-332`).

---

## 5. "Looks wired but inert" findings (file:line each)

1. **WhatsApp ES button reads the wrong SDK field.** `whatsapp-embedded-signup.tsx:36` reads `authResponse.accessToken` while `:74` forces `response_type:"code"`. Result: click → Meta dialog → silent return to idle. No POST. (Primary WA break.)
2. **No `message`/`postMessage` listener for ES session info.** `whatsapp-embedded-signup.tsx` never registers a `window` `message` handler, so the WABA/phone-number-id payload that `response_type:"code"` ES delivers is dropped. `sessionInfoVersion:"2"` (`:78`) is set but unused.
3. **Token-type contract mismatch end-to-end.** Component forwards what it _calls_ `esToken` (an access token) but is configured to receive a `code`; API `debug_token` (`whatsapp-meta.ts:82`) needs an access token. The chain only succeeds if the browser actually forwards a customer access token, which the current SDK config + reader do not produce.
4. **Meta Ads OAuth button passes no `deploymentId`.** `connections-list.tsx:332` calls `getUrl()` argless → authorize route 400 (`authorize/route.ts:9`). Button is dead.
5. **Meta Ads OAuth success redirects to a non-existent page.** `facebook-oauth.ts:171` → `/connections/callback`; no such route in `apps/dashboard/src/app`. 404 on success.
6. **ES onboard persists `organizationId: ""`.** `apps/api/src/bootstrap/routes.ts:207` — created WhatsApp connection is not tenant-scoped; would not appear in an org-scoped connections list and is mis-attributed.
7. **Optimistic success that can't fire.** `whatsapp-embedded-signup.tsx:52-62` only enters the "Connected" UI when `data.success` is truthy from the onboard POST — unreachable today because finding (1) prevents the POST entirely.
8. **CSP lacks `frame-src` for Meta.** `next.config.mjs:11-22` — any framed Meta UI (ES overlay / xfbml iframe) is blocked by default-src `'self'`; only the script host is allowed (`:18`).

---

## 6. Demo-ability verdict + ordered blocker list

**Can we record a logged-in user clicking Connect → Meta popup → "Connected" TODAY? NO — for both flows.**

The surface is _half real_: SDK loads correctly behind a real session with a static (inlinable) env gate, CSP allows the script, and `/settings/channels` is reachable with no demo/entitlement gate. The breaks are all in the second half of each flow.

### WhatsApp Embedded Signup — ordered blockers to a recordable demo

1. **Set build-time env:** `NEXT_PUBLIC_META_APP_ID` + `NEXT_PUBLIC_META_CONFIG_ID` (else the ES card never renders — `connections-list.tsx:346`). Set API env `META_SYSTEM_USER_TOKEN`, `META_SYSTEM_USER_ID`, `META_APP_SECRET`, `CHAT_PUBLIC_URL` (`routes.ts:186-191`).
2. **Fix the SDK response handling (`whatsapp-embedded-signup.tsx:34-48`):** either switch to `response_type:"token"` and forward `authResponse.accessToken` as `esToken`, OR keep `response_type:"code"`, add a `window` `message` listener to capture the ES `session info` (waba_id / phone_number_id), and exchange the `code` for a token server-side. Without this, the button is silently inert (finding 1/2/3).
3. **Add `frame-src https://www.facebook.com` to CSP** (`next.config.mjs:11-22`) if the ES experience renders any Meta iframe; verify the live popup/iframe in a browser network panel.
4. **Scope the created connection to the caller's org** (`routes.ts:207` + resolve org in `whatsapp-onboarding.ts`) so the "Connected" state is real and tenant-correct (finding 6).
5. Confirm the success state renders (`whatsapp-embedded-signup.tsx:87-96`) once the POST actually returns `success:true`.

### Meta Ads / Facebook connect — ordered blockers to a recordable demo

1. **Provide a `deploymentId` to the OAuth button** (`connections-list.tsx:332` / `service-field-configs.ts:49`). `ConnectionsList` has no deployment context — either add a deployment picker, or drive this flow from a deployment-scoped page that already knows the id (the API + proxy are correct once an id is present).
2. **Set API env:** `META_APP_ID`, `META_APP_SECRET`, `META_OAUTH_REDIRECT_URI`, plus `DASHBOARD_URL` (`meta-oauth-config.ts:27-31`; `facebook-oauth.ts:169`).
3. **Create the post-OAuth landing page** the callback redirects to: `/connections/callback` (`facebook-oauth.ts:171`) — render a "Connected" success state. Today it 404s (finding 5).
4. (Optional but expected for the video) a visible "Connected" badge update on the connections list after callback.

**Fastest path to _a_ recordable Meta permission flow:** the **Meta Ads OAuth** chain is closer to working — its API authorize+callback+token-exchange+store legs are fully implemented and tested (`facebook-oauth.ts`, `oauth-connection-tenant-isolation.test.ts`). It needs only (a) a `deploymentId` wired into the button and (b) a `/connections/callback` success page. The WhatsApp ES flow needs a more substantive client-side fix (response-type/message-listener) before it can complete at all.

---

## Appendix — files inspected

- Components: `whatsapp-embedded-signup.tsx`, `meta-sdk-script.tsx`, `connections-list.tsx`, `whatsapp-management.tsx`
- Types: `src/types/facebook.d.ts`
- Hooks: `use-whatsapp-management.ts`, `use-whatsapp-template-create.ts`, `use-managed-channels.ts`
- Lib: `api-client/whatsapp.ts`, `api-client/index.ts`, `api-client/marketplace.ts`, `service-field-configs.ts`, `provision-status-message.ts`, `query-keys.ts`, `get-api-client.ts`
- Dashboard routes: `api/dashboard/connections/whatsapp-embedded/route.ts`, `api/dashboard/whatsapp/account/route.ts`, `phone-numbers/route.ts`, `templates/route.ts`, `api/dashboard/connections/facebook/authorize/route.ts`
- Pages/layout: `app/(auth)/settings/page.tsx`, `settings/channels/page.tsx`, `settings/channels/whatsapp/page.tsx`, `app/(auth)/layout.tsx`, `middleware.ts`, `next.config.mjs`
- API: `apps/api/src/routes/facebook-oauth.ts`, `routes/whatsapp-onboarding.ts`, `lib/whatsapp-meta.ts`, `bootstrap/routes.ts:180-221`, `utils/meta-oauth-config.ts`
- Tests reviewed: `app/__tests__/meta-sdk-surface.test.ts`, `components/settings/__tests__/meta-sdk-script.test.tsx`
- Env: `.env.example:124-146,326-336`, `scripts/env-allowlist.local-readiness.json:66-88`
