# WhatsApp Embedded Signup onboarding — implementation plan (.claude scratch, uncommitted)

> For agentic workers: REQUIRED SUB-SKILL superpowers:subagent-driven-development / executing-plans. One PR per task. TDD: RED before GREEN.

**Goal:** Make Tech-Provider WhatsApp Embedded Signup actually onboard a tenant — persist a real, usable, org-scoped connection; exchange the OAuth code server-side; light up the dashboard button — the WhatsApp mirror of shipped slice 1 (PR #1078, ads connect path).

**Workstream:** launch. **Authority:** SURFACE-before-merge for every WA credential/auth/onboarding-path PR (the user makes those merge calls); AUTONOMOUS-WITH-GUARDRAILS for the two no-stop-glob ground-coverers (CSP, status-store).

**Base:** origin/main @ `e6ebfe906` (local HEAD == origin/main, verified 2026-06-15).

---

## Decision D-b — WA runtime token model (RESOLVED, self-directed per user delegation)

**Question (from the roadmap memory + audit B §10 blocker 2):** when an ESU-onboarded channel sends/receives at runtime, what credential does it authenticate with? Two regimes coexist today: the central `META_SYSTEM_USER_TOKEN` (used by management/send-test/template-create AND by the onboard route's own Graph calls) vs a per-tenant `creds.token` (used by the inbound→reply runtime, `runtime-registry.ts:167`).

**Decision: the central System-User token (`META_SYSTEM_USER_TOKEN`) is the canonical runtime credential.** PR-1 persists that central token into the connection's encrypted `creds.token` at onboard time, so the existing runtime — which already reads `creds.token` as the Bearer (`runtime-registry.ts:167-172`) — sends on it with **zero runtime/chat changes and no inert cross-app seam**. A later hardening slice (PR-4, optional) adds an env-read fallback (`creds.token ?? META_SYSTEM_USER_TOKEN`) so token rotation does not require re-provisioning every connection.

**Why this is smallest + doctrine-consistent:**

- The onboarding route already does ALL real Graph work (assigned_users, phone_numbers, register, subscribed_apps, profile) with `metaSystemUserToken` (`whatsapp-onboarding.ts:49`); the ESU token is used ONLY to discover the WABA via `debug_token`. The central token is already the de-facto credential — this just makes the runtime use the same one.
- Matches the documented doctrine (roadmap memory: "Graph token comes from `process.env.META_SYSTEM_USER_TOKEN`, NOT from `Connection.credentials`") and the management/send-test surfaces.
- The stored central token is long-lived (a System-User token), so no "works in demo, dies in hours" trap.
- Touches **apps/api only** for PR-1 — no apps/chat change, no new chat env, no env-allowlist entry, no inert seam. Backward compatible: BYOT connections keep their own `creds.token`.

**Rejected alternatives:**

- **(a) Store the per-onboarding ESU-exchanged token in `creds.token`.** The first code→token exchange can yield a short-lived token → channel dies after hours (the "looks-wired-but-inert" failure class). Rejected. (We still perform the exchange transiently for authoritative WABA introspection, but do not store it as the long-lived credential.)
- **(b-env only) Pure env fallback in the runtime now (no stored token).** Requires `META_SYSTEM_USER_TOKEN` in the apps/chat service + a new env-allowlist entry + deploy provisioning (cf. #1076), and leaves the connection **inert until that lands** (cross-app producer/consumer seam — violates `feedback_safety_gate_needs_producer_population`). Heavier and riskier for the first slice. Deferred to PR-4 as a non-blocking hardening follow-up.
- **(c) Keep per-tenant BYOT only (status quo).** Not Tech-Provider; needs operators to hand-paste tokens; ESU can't auto-provision. It is precisely what we are replacing. Rejected.

**Out of scope (user's product/strategy calls — DO NOT build):** D-a (ads central-token model / drop business_management), D-c (campaign activation / money path), D-d (Instagram DMs), per-tenant CAPI.

---

## Verified ground truth (origin/main @ e6ebfe906)

| Claim                                                                                                                    | Status    | Evidence                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Dashboard button reads `authResponse.accessToken` under `response_type:"code"`, no message listener                      | CONFIRMED | `whatsapp-embedded-signup.tsx:36,74` — `code` flow returns `authResponse.code` + a `message` event, never `accessToken`; line 37-39 silently returns to idle |
| Onboard route takes a token, not a code; no code→token exchange                                                          | CONFIRMED | `whatsapp-onboarding.ts:74,79` body `{ esToken }`; no `/oauth/access_token` exchange in the WA path                                                          |
| Phantom persistence                                                                                                      | CONFIRMED | `bootstrap/routes.ts:199` `token: data.wabaId`; `:207` `organizationId: ""`; no `appSecret`/`verifyToken` in encrypted creds                                 |
| Runtime needs `creds.token` + `creds.phoneNumberId` or adapter is null                                                   | CONFIRMED | `runtime-registry.ts:167-169`; also reads `creds.appSecret`/`creds.verifyToken` (`:170-172`)                                                                 |
| `createConnection` is an injected opt (persistence lives in bootstrap)                                                   | CONFIRMED | `whatsapp-onboarding.ts:25-30,135`; closure at `bootstrap/routes.ts:197-217`                                                                                 |
| Org resolver for mutations exists                                                                                        | CONFIRMED | `org-access.ts` `resolveOrganizationForMutation(request, reply, bodyOrgId)` — trusts `organizationIdFromAuth` in prod, body org in dev                       |
| Ads `exchangeCodeForToken` exists but passes `redirect_uri` (ESU JS-SDK code omits it)                                   | CONFIRMED | `packages/ad-optimizer/src/facebook-oauth.ts:104-121` — need a WA ESU variant                                                                                |
| `subscribed_apps` registers `verify_token = opts.appSecret`; stored creds must echo the same value for the GET handshake | CONFIRMED | `whatsapp-onboarding.ts:153`; `whatsapp.ts:108-122` constant-time compares `creds.verifyToken`                                                               |
| Next proxy forwards body but attaches NO Bearer → prod onboard would 401                                                 | CONFIRMED | `app/api/dashboard/connections/whatsapp-embedded/route.ts:10-14` — no auth header                                                                            |

---

## Task 1 (PR-1) — Persist a real, usable, org-scoped connection [credential path → SURFACE]

**The headline fix.** Kills the phantom-persistence bug so the _existing_ `esToken` onboard path yields a channel the runtime can actually run. No code-exchange or dashboard change yet — those are PR-2/PR-3.

**Files:**

- Create: `apps/api/src/lib/whatsapp-connection-data.ts` (pure builder) + `apps/api/src/lib/__tests__/whatsapp-connection-data.test.ts`
- Modify: `apps/api/src/routes/whatsapp-onboarding.ts` (expand `createConnection` opt sig; resolve + thread `organizationId`; pass central token + verifyToken)
- Modify: `apps/api/src/bootstrap/routes.ts:197-217` (use the builder; real org/token/appSecret/verifyToken)
- Test: `apps/api/src/routes/__tests__/whatsapp-onboarding.test.ts` (extend persistence assertions)

- [ ] **Step 1 (RED): builder unit test.** `buildWhatsAppOnboardConnection({ organizationId, wabaId, phoneNumberId, displayPhoneNumber, runtimeToken, appSecret, verifyToken })` returns `{ id?, organizationId, serviceId:"whatsapp", serviceName:"whatsapp", authType:"bot_token", externalAccountId: wabaId, scopes:[], credentials }` where `decryptCredentials(credentials)` yields `{ token: runtimeToken, phoneNumberId, primaryPhoneNumberId: phoneNumberId, displayPhoneNumber, appSecret, verifyToken }`. Assert `token !== wabaId` and `organizationId` is the passed org (the two bug-regressions). Run: `pnpm --filter @switchboard/api... ` → FAIL (module missing).
- [ ] **Step 2 (GREEN):** implement the pure builder using `encryptCredentials` from `@switchboard/db`. Run test → PASS.
- [ ] **Step 3 (RED): route threads org + token.** Extend `whatsapp-onboarding.test.ts`: inject a `createConnection` spy; POST with auth context carrying an org (or dev body `organizationId`); assert the spy is called with `organizationId` set (NOT "") and a `runtimeToken` equal to the configured `metaSystemUserToken`, plus `verifyToken` equal to the value passed to `subscribed_apps`. RED: current route passes neither.
- [ ] **Step 4 (GREEN):** in the route, `const orgId = resolveOrganizationForMutation(request, reply, body.organizationId); if (orgId === null) return;`. Expand the `createConnection` opt type to `{ wabaId, phoneNumberId, verifiedName?, displayPhoneNumber?, organizationId, runtimeToken, verifyToken }` and pass them; the verifyToken value is the SAME one handed to `registerWebhookOverride` (single source so they can't drift). Run → PASS.
- [ ] **Step 5 (GREEN): bootstrap uses the builder.** Replace the inline `createConnection` closure to call `buildWhatsAppOnboardConnection({ organizationId: data.organizationId, runtimeToken: data.runtimeToken /* = metaSystemUserToken */, appSecret: process.env.META_APP_SECRET ?? "", verifyToken: data.verifyToken, ... })` then `app.prisma!.connection.create({ data })`. Run full api test → PASS.
- [ ] **Step 6 (seam pin):** add a test that feeds the builder's `credentials` shape into the runtime adapter contract — assert the whatsapp branch of `createAdapterForConnection` (or a shared shape check) returns non-null for the persisted creds (token + phoneNumberId present). Prevents producer/consumer drift (`feedback_per_slice_review_misses_cross_slice_seams`).
- [ ] **Step 7:** gates (delegated) + independent review + surface PR-1.

**Acceptance:** persisted `Connection` has a real `organizationId`, `creds.token` = central system token (usable Bearer), `creds.appSecret` + `creds.verifyToken` set; runtime can build an adapter from it. Onboarding "success" is no longer a phantom.

## Task 2 (PR-2) — Server code→token exchange (ESU code flow) [credential path → SURFACE]

**Files:**

- Modify: `apps/api/src/lib/whatsapp-meta.ts` (add `exchangeEsuCodeForToken`) + its test `lib/__tests__/whatsapp-meta.test.ts`
- Modify: `apps/api/src/routes/whatsapp-onboarding.ts` (accept `{ code }` additively; exchange → token → use as `userToken` for `fetchWabaIdFromToken`)
- Modify: `apps/api/src/bootstrap/routes.ts` (plumb `appId` = `META_APP_ID`/`META_SYSTEM_USER...`; reuse `META_APP_SECRET`)

- [ ] **Step 1 (RED):** `exchangeEsuCodeForToken({ apiVersion, appId, appSecret, code, fetchImpl? })` → `GET /<v>/oauth/access_token?client_id&client_secret&code` (NO redirect_uri — JS-SDK code), returns `{ ok:true, accessToken } | { ok:false, reason }`. Test asserts URL has no `redirect_uri`, carries client_id/secret/code, parses `access_token`. RED: fn missing.
- [ ] **Step 2 (GREEN):** implement mirroring `fetchWabaIdFromToken` error-handling style. PASS.
- [ ] **Step 3 (RED):** route test — POST `{ code }` (no esToken): asserts an exchange fetch happens, then `debug_token` is called with `input_token` = the exchanged token. Keep an esToken-path test green (additive, not a replacement). RED: route ignores `code`.
- [ ] **Step 4 (GREEN):** route: if `body.code`, exchange → `userToken`; else use `body.esToken`; 400 if neither. PASS. Gates + review + surface.

## Task 3 (PR-3) — Dashboard ESU button + authed Next proxy [onboarding path → SURFACE]

**Files:**

- Modify: `apps/dashboard/src/components/settings/whatsapp-embedded-signup.tsx` (read `authResponse.code`; add `message` listener for `WA_EMBEDDED_SIGNUP` session info → waba_id/phone_number_id; POST `{ code, wabaId, phoneNumberId }`; remove listener on cleanup)
- Modify: `apps/dashboard/src/app/api/dashboard/connections/whatsapp-embedded/route.ts` (forward via the authed API client so the API sees the operator org — fixes the 401 hole; cf. `feedback_dashboard_api_needs_next_proxy_route`)
- Test: co-located component test (jsdom) + proxy route test

- [ ] **Step 1 (RED):** component test — simulate `FB.login` callback with `authResponse.code` + a posted `message` event; assert fetch body is `{ code, wabaId, phoneNumberId }`. RED: reads `accessToken`, no listener.
- [ ] **Step 2 (GREEN):** implement; ensure listener cleanup (no leak) and `override_default_response_type` stays. PASS.
- [ ] **Step 3 (RED→GREEN):** proxy test — asserts the forwarded request carries the operator Bearer (authed client), body passthrough. Implement. Gates (incl. `--filter dashboard build` + `.tsx` prettier) + review + surface.

## Task 4 (PR-4, hardening, optional) — runtime env-fallback token [credential path → SURFACE]

**Files:** `apps/chat/src/managed/runtime-registry.ts:166-176` (`token = creds.token ?? process.env.META_SYSTEM_USER_TOKEN`); `scripts/env-allowlist.local-readiness.json` (+ META_SYSTEM_USER_TOKEN for chat); co-located runtime-registry test.

- [ ] RED: connection creds WITHOUT token + env set → whatsapp adapter built (non-null) using env token; connection WITH token → uses creds token (BYOT preserved). GREEN: implement fallback + allowlist entry. Independent of PR-1..3 (additive resilience). Gates (verify-fast catches the allowlist) + review + surface.

## PLAN-ONLY (do NOT build now — own slices; surfaced as backlog)

- **PIN 2-step handling** (`whatsapp-onboarding.ts:129-132`): `/register` hardcodes pin `000000`; handle 409/PIN-conflict + number-migration (`request_code`/`verify_code`). Its own slice; needs live-Graph thought.
- **Credit-line sharing** (`whatsapp-onboarding.ts` after step 4): `whatsapp_credit_sharing` / extendedcredits. Touches the provider's billing line → money-adjacent; likely needs a D-decision before build.

## DECISION-INDEPENDENT GROUND-COVERERS (no stop-glob → AUTONOMOUS-WITH-GUARDRAILS, may auto-merge when gates+review clean)

- **S-A — Meta frame-src in dashboard CSP** (`apps/dashboard/next.config.mjs`): allow the Meta ESU popup/SDK origins in `frame-src`/`script-src`. Config only; no auth/credential/send logic. TDD via a config assertion test if one exists, else a build + header check.
- **S-B — wire `PrismaWhatsAppStatusStore` from the real inbound handler** (apps/chat managed-webhook path): persist delivery/read receipts for real conversations (audit finding #6); currently only the test-send bridge is wired. Inbound STATUS path, not a `*send*` path → no stop-glob. Co-located test.

## Loop order

PR-1 (surface) → S-A + S-B (auto-merge ground cover, independent) → PR-2 (surface) → PR-3 (surface) → PR-4 (surface). STOP when every task above has an open PR and S-A/S-B are merged, OR when a step needs a user D-decision.
