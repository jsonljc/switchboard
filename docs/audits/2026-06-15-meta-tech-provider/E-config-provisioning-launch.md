# E — Config, Credentials, Provisioning, Launch-Readiness, Feature Flags (Meta Tech Provider)

Read-only audit. Date 2026-06-15. Scope: the operational layer that determines whether
the (audited-elsewhere) Meta Ads + WhatsApp Embedded Signup code can run live. Every claim
cites `file:line` or a doc path.

---

## 1. Config Inventory — Meta / WhatsApp env vars

Legend: **Secret** = must not appear client-side. **Central** = one system-user value for all
tenants. **Tenant** = per-org credential (stored encrypted in DB, NOT env, except the
single-tenant chat fallback). **Required?** = boot-fail / throw / silently-disables.

| Var                                             | Purpose                                                                                           | Secret?            | Central/Tenant              | Required? (behavior if missing)                                                                                                          | Reader (file:line)                                                                                                                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `META_APP_ID`                                   | Meta App ID; OAuth connect + token-refresh cron                                                   | No (public-safe)   | Central                     | **Throws** at OAuth connect/refresh if absent AND `FACEBOOK_APP_ID` absent                                                               | `apps/api/src/utils/meta-oauth-config.ts:16,29`; `packages/db/src/oauth/token-refresh.ts:29`                                                                                                       |
| `META_APP_SECRET`                               | Webhook HMAC verify (lead webhook + deletion callback); OAuth secret                              | **Yes**            | Central                     | Silent-fail-closed for webhooks (returns false → rejects); **throws** in OAuth resolver                                                  | `apps/api/src/routes/ad-optimizer.ts:29,74`; `apps/api/src/routes/meta-deletion.ts:102`; `meta-oauth-config.ts:17`; `token-refresh.ts:30`; passed to whatsapp-onboarding `bootstrap/routes.ts:188` |
| `META_CONFIG_ID`                                | FB Login config for Embedded Signup popup                                                         | No                 | Central                     | Browser-only; consumed as `NEXT_PUBLIC_META_CONFIG_ID` (see below). **No server reader of bare `META_CONFIG_ID`.**                       | (none server-side)                                                                                                                                                                                 |
| `META_SYSTEM_USER_TOKEN`                        | Permanent SUAT for all client WABAs — Embedded Signup Graph calls, WA management, template create | **Yes**            | Central                     | Defaults to `""`; template-create returns **HTTP 500 `WHATSAPP_TOKEN_MISSING`**; onboarding/management Graph calls 401 with empty bearer | `bootstrap/routes.ts:186`; `routes/whatsapp-management.ts:227`; `routes/whatsapp-template-create.ts:101,106`                                                                                       |
| `META_SYSTEM_USER_ID`                           | System User ID for `assigned_users` calls                                                         | No                 | Central                     | Defaults `""` → `assigned_users` call malformed (silent partial)                                                                         | `bootstrap/routes.ts:187`                                                                                                                                                                          |
| `META_GRAPH_VERSION`                            | Graph API version pin                                                                             | No                 | Central                     | Defaults `"v21.0"` if unset                                                                                                              | `routes/whatsapp-template-create.ts:9`; `routes/whatsapp-management.ts:119`                                                                                                                        |
| `META_OAUTH_REDIRECT_URI`                       | OAuth callback for Meta Ads connect + refresh cron                                                | No                 | Central                     | **Throws** in OAuth resolver if absent AND `FACEBOOK_REDIRECT_URI` absent                                                                | `meta-oauth-config.ts:18,29`                                                                                                                                                                       |
| `META_WEBHOOK_VERIFY_TOKEN`                     | GET handshake verify token for Meta webhook                                                       | **Yes**            | Central                     | **Throws** `getVerifyToken()` when the webhook GET handler runs without it (per-request, not boot)                                       | `routes/ad-optimizer.ts:7,10`                                                                                                                                                                      |
| `META_CAPI_ACCESS_TOKEN`                        | Conversions API token for the bootstrap conversion bus                                            | **Yes**            | Central                     | Silently disables CAPI dispatch (only wires `MetaCAPIDispatcher` when both pixel+token set)                                              | `bootstrap/conversion-bus-bootstrap.ts:55,57`                                                                                                                                                      |
| `META_PIXEL_ID`                                 | Pixel id for CAPI + browser pixel                                                                 | No (public-safe)   | Central                     | Silently disables CAPI dispatch when unset                                                                                               | `bootstrap/conversion-bus-bootstrap.ts:54`                                                                                                                                                         |
| `NEXT_PUBLIC_META_APP_ID`                       | Browser JS SDK app id (Embedded Signup)                                                           | No                 | Central                     | Embedded-Signup button hidden when falsy (`connections-list.tsx:346`); SDK script no-ops (`meta-sdk-script.tsx:17`)                      | `apps/dashboard/src/components/settings/connections-list.tsx:346,349`; `meta-sdk-script.tsx:17`                                                                                                    |
| `NEXT_PUBLIC_META_CONFIG_ID`                    | Browser FB Login config id                                                                        | No                 | Central                     | Passed to popup as `metaConfigId`; empty → Embedded Signup cannot launch a config                                                        | `connections-list.tsx:350`                                                                                                                                                                         |
| `WHATSAPP_TOKEN`                                | Per-tenant Cloud API token (single-tenant chat)                                                   | **Yes**            | Tenant (env, single-tenant) | One of the "no channel configured" boot warnings (api + chat)                                                                            | `apps/api/src/app.ts:404,424`; `apps/chat/src/startup-checks.ts:31,36`                                                                                                                             |
| `WHATSAPP_PHONE_NUMBER_ID`                      | Phone number id for sends (greeting/reminder/followup workflows)                                  | No                 | Tenant                      | Lead-greeting / reminder / followup sends short-circuit (read at send-time)                                                              | `apps/api/src/app.ts:405`; `services/workflows/meta-lead-greeting-workflow.ts:13`; `conversation-reminder-send-workflow.ts:83`; `conversation-followup-send-workflow.ts:88`                        |
| `WHATSAPP_APP_SECRET`                           | WA webhook (chat) sig verify; also used as the WA provision-status "verify token" gate            | **Yes**            | Tenant                      | Provision-status marks `config_error` for WhatsApp channel if absent                                                                     | `apps/api/src/routes/organizations.ts:380,385`; (chat webhook verify)                                                                                                                              |
| `WHATSAPP_ACCESS_TOKEN`                         | Per-tenant token used by lead-greeting / reminder / followup workflows                            | **Yes**            | Tenant                      | Those workflow sends short-circuit when unset                                                                                            | `services/workflows/meta-lead-greeting-workflow.ts:12`; `conversation-reminder-send-workflow.ts:82`; `conversation-followup-send-workflow.ts:87`                                                   |
| `WHATSAPP_GRAPH_TOKEN`                          | Central app token for `/subscribed_apps` webhook auto-registration                                | **Yes**            | Central                     | Provision-status marks `config_error` for WhatsApp channel if absent                                                                     | `apps/api/src/routes/organizations.ts:379,384`; `lib/whatsapp-meta.ts:9`                                                                                                                           |
| `FACEBOOK_APP_ID` / `_SECRET` / `_REDIRECT_URI` | **Deprecated** full-set OAuth alias (one-release fallback)                                        | secret = `_SECRET` | Central                     | Used only if the full `META_*` OAuth triple is absent (group-resolved, never field-mixed)                                                | `meta-oauth-config.ts:21-23,25`                                                                                                                                                                    |

### 1a. Var in `.env.example` that NO production code reads

- `META_CONFIG_ID` (`.env.example:136`) — **no server-side reader.** Only the
  `NEXT_PUBLIC_META_CONFIG_ID` mirror is consumed (`connections-list.tsx:350`). The bare
  var is documentation/parity scaffolding for the browser mirror; harmless but inert.

### 1b. Vars code reads that are MISSING from `.env.example` AND the allowlist

- **None found.** Every Meta/WhatsApp var read by code is present in both
  `.env.example:124-146,325-336` and `scripts/env-allowlist.local-readiness.json:65-73,87-88,132-136,47-49,70`.
  The `META_GRAPH_VERSION` allowlist entry is at line 68. `META_SYSTEM_USER_TOKEN` at 72.
  No CI lint/test failure risk from a missing Meta/WA var. (The completeness gate is
  `scripts/check-env-completeness.ts`, per the allowlist `$schema-note`.)

### 1c. Notable mismatch (not a CI failure, but a correctness gotcha)

- `apps/api/src/routes/organizations.ts:380` names the variable `verifyToken` but reads
  `WHATSAPP_APP_SECRET` — i.e. the WA provision-status path treats the **app secret** as the
  webhook gate, while the actual webhook GET handshake verify token is
  `META_WEBHOOK_VERIFY_TOKEN` (`ad-optimizer.ts:7`). Two different secrets gate two
  different WA registration legs; both must be set. Flagged for the code-audit track.

---

## 2. Provisioning — what is auto-seeded vs manual

### `scripts/provision-pilot.mts` (reportedly shipped, NOT yet run)

Seeds, via `provisionPilotOrg` (`packages/db/src/seed/provision-org-with-owner.ts`):

- Org (comped entitlement + default business hours), owner Principal + IdentitySpec +
  DashboardUser (bcrypt temp password, encrypted apiKey), `emailVerified` stamped now
  (`provision-pilot.mts:94-99`).
- Day-one agent **enablement** rows (alex, riley) via `seedOrgDayOneAgents`
  (`provision-org-with-owner.ts:114`).
- Riley's **deployment** via `provisionOrgAgentDeployments(..., { mira: false })`
  (`provision-org-with-owner.ts:131`; idempotent re-run at `provision-pilot.mts:84-85`).

**Does NOT seed any Meta/WhatsApp credential or Connection.** Verified:
`packages/db/src/seed/provision-org-agents.ts` contains **zero** references to
`connection`, `credential`, `whatsapp`, `meta-ads`, `DeploymentConnection`, or `encrypt`
(grep returned nothing). It seeds listings + deployments + governance + enablement only.

### `scripts/provision-mira-for-org.mts`

- Deliberate day-thirty action: `provisionOrgAgentDeployments(prisma, orgId, { mira: true })`
  (`provision-mira-for-org.mts:26`) → Mira deployment + recommendation-handoff governance +
  Mira enablement; re-ensures Riley as idempotent no-op. **No credentials seeded.**

### Credentialing is MANUAL (by design)

Per `docs/superpowers/plans/2026-06-10-riley-remediation-tier0-pilot-provisioning.md:46`:

> "An operator enters Meta creds in the existing Settings UI (writes an org `Connection`,
> `serviceId="meta-ads"`); Riley's resolver falls back to it when no `DeploymentConnection`
> exists."

The resolver fallback is live: `buildRileyCredentialResolver`
(`apps/api/src/bootstrap/riley-credential-resolver.ts:43-58`) tries the deployment-scoped
`DeploymentConnection(type="meta-ads")` first, then falls back to the org-level
`Connection(serviceId="meta-ads")`; wired at `apps/api/src/bootstrap/inngest.ts:420`. Dead
tokens (expired/revoked/needs_reauth) are skipped from both sources
(`riley-credential-resolver.ts:48,40`). **A pilot org therefore has Riley deployed but
inert until an operator manually credentials Meta Ads in Settings.**

WhatsApp credentials likewise are NOT seeded by either script. WA reaches "active" only
through (a) the single-tenant env path (`WHATSAPP_TOKEN`+`WHATSAPP_PHONE_NUMBER_ID`,
`app.ts:404-405`), or (b) the Embedded Signup onboarding route writing an encrypted
`Connection(serviceId="whatsapp")` (`bootstrap/routes.ts:200` `createConnection` →
`encryptCredentials` → `connection.create`).

### Spec corroboration

`docs/superpowers/specs/2026-06-10-org-agent-synergy-provisioning-design.md:40`:

> "Riley also needs a Meta Ads connection before its cron does anything. Provisioning Riley
> unconditionally at signup is therefore safe."

So provisioning = **capability surface only**, never credentials and never permission to
act (entitlement gate at ingress; spec line 40).

---

## 3. Data Deletion + privacy — Meta App Review requirement

**Real, signed-request-verified, and registered. PASS.**

- Handler: `apps/api/src/routes/meta-deletion.ts` — `POST /` verifies the
  `signed_request` via `parseAndVerifySignedRequest(signedRequest, appSecret)`
  (`meta-deletion.ts:110`), then erases matching Contacts (`eraseContactFully`,
  `:138`), persists a `DataDeletionRequest` row, and returns
  `{ url, confirmation_code }` per Meta's spec (`:186`). Public status check at
  `GET /status?code=` (`:191-230`).
- Verifier: `apps/api/src/lib/meta-signed-request.ts` — HMAC-SHA256 over the **encoded**
  payload, `timingSafeEqual` constant-time compare, **fails closed** on empty input, empty
  secret, malformed structure, signature mismatch, non-JSON, or missing `user_id`
  (`meta-signed-request.ts:47-89`). Never throws on bad input.
- Registered: `app.register(metaDeletionRoutes, { prefix: "/api/meta/deletion" })`
  (`apps/api/src/bootstrap/routes.ts:258`; import `:63`).
- Auth-bypassed correctly (request comes from Meta, integrity is the HMAC):
  `apps/api/src/middleware/auth.ts:135-136` exempts `/api/meta/deletion` and
  `/api/meta/deletion/status`.
- Rate-limited 10/min per IP to protect the HMAC path (`meta-deletion.ts:85-90`).
- PII-safe logging: phone values masked, stack dropped (`describeDeletionError`, `:46-58`).
- **Caveat:** depends on `META_APP_SECRET` being set. With empty secret the verifier returns
  `{ ok:false, reason:"empty_secret" }` (`meta-signed-request.ts:53`) → every deletion 400s.
  Operationally required before app review.

---

## 4. Readiness probes — green or red today (default/empty env)?

### `apps/api/src/routes/readiness.ts` (`GET /:agentId/readiness`)

12 checks (`readiness.ts:289-334`). **Blocking** checks decide `ready`:

- email-verified (`:338`), channel-connected (`:354`), deployment-exists (`:381`),
  deployment-connection (`:400`), business-identity (`:430`), services-defined (`:453`),
  hours-set (`:473`), alex-skill-pack-seeded (`:577`).
- **Advisory (non-blocking):** test-scenarios-run, approval-mode-reviewed,
  **meta-ads-token** (`:533`, `blocking=false`), calendar, business-facts-present.

Meta-ads readiness: `checkMetaAdsToken` reads `ctx.metaAdsConnection.exists`, which is true
only when a `DeploymentConnection(type="meta-ads", status="active")` exists
(`readiness.ts:234-241`). On a freshly provisioned pilot org (no Meta creds entered) →
`exists=false` → returns `{status:"fail", message:"Meta Ads not connected"}` (`:538-539`)
— but **non-blocking**, so it does NOT make `ready=false`. The blocking gate is
channel/deployment/business-identity/skill-pack, NOT Meta Ads.

**Verdict (default/empty env, fresh org):** `ready=false`, driven by the blocking checks
(no verified channel, no active deployment-connection, business-identity/services/hours
empty, possibly skill-pack). Meta-ads shows a red advisory line but is not the blocker.
Note WhatsApp channel-connected additionally requires `conn.lastHealthCheck !== null`
(`readiness.ts:366`) — a WA channel is not "verified" until a test-connection probe has run.

### `apps/api/src/lib/whatsapp-health-probe.ts`

`probeWhatsAppHealth` does `GET https://graph.facebook.com/<apiVersion>/<phoneNumberId>`
with the customer-decrypted token (`whatsapp-health-probe.ts:35-39`). Returns
`ok:false` on non-2xx or fetch error (`:41-55`). With default/empty env there is no token
and the probe is not invoked at boot; when run during provision with an empty/missing token
it returns `ok:false` (`health probe returned HTTP 401` or fetch error). It is a synchronous
provision-time probe, not a passive boot gate. The provision-status resolver
(`apps/api/src/lib/resolve-provision-status.ts:46-75`) folds it: missing
`WHATSAPP_GRAPH_TOKEN`/`WHATSAPP_APP_SECRET` → `config_error`; failing probe →
`health_check_failed`; only all-green → `active`.

**Net:** today, with empty env, both readiness surfaces report **RED** for the Meta/WA
legs — correctly. Nothing falsely reports green.

---

## 5. Feature-flag ledger (Meta / WhatsApp / money / messaging)

| Flag                                      | Default                                    | Gates                                                                                                                                                                                 | Dark today?                                                                                                                                    |
| ----------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `RILEY_REALLOCATE_SELF_EXECUTION_ENABLED` | `false` (`.env.example:379`)               | Wires the budget-reallocation self-submission initiator (`rileyBudgetSubmitter`) into the weekly audit. Off → never wired.                                                            | **YES — money path dark** (`inngest.ts:494-496`). Even ON, every move parks for mandatory human approval; intent is on the financial denylist. |
| `RILEY_PAUSE_SELF_EXECUTION_ENABLED`      | `false` (`.env.example:374`)               | Wires the pause self-submission initiator (`rileyPauseSubmitter`); per-org `governanceSettings.pauseSelfExecutionEnabled` must ALSO be true.                                          | **YES — dark** (`inngest.ts:488-490`). Two-gate.                                                                                               |
| `RILEY_OUTCOME_ATTRIBUTION_ENABLED`       | `false` (`.env.example:369`)               | PR-3 outcome-attribution sweep.                                                                                                                                                       | YES (`inngest.ts:1043`).                                                                                                                       |
| `FOLLOWUP_ALLOW_MARKETING_TEMPLATE`       | unset → `false` (`.env.example:153`)       | Allows Alex re-engagement **marketing** WhatsApp template sends. Off → marketing templates blocked.                                                                                   | **YES — messaging (marketing) dark** (`bootstrap/contained-workflows.ts:330`). Flip only with a Meta-approved template.                        |
| `CREATIVE_ATTRIBUTION_ENABLED`            | `false` (`.env.example:383`)               | Mira per-creative attribution sweep.                                                                                                                                                  | YES (`inngest.ts:1081`).                                                                                                                       |
| `ALEX_MODEL_ROUTER_ENABLED`               | `false` (`.env.example:387`)               | Alex per-turn Haiku/Sonnet/Opus model tiering.                                                                                                                                        | YES (`bootstrap/model-router-factory.ts:17`). Not Meta-specific.                                                                               |
| `MIRA_SELF_BRIEF_ENABLED`                 | `false` (`.env.example:392`)               | Mira weekly self-brief loop.                                                                                                                                                          | YES (`inngest.ts:1128`).                                                                                                                       |
| `MIRA_HANDOFF_BRIEF_ENRICHMENT_ENABLED`   | `false` (`.env.example:397`)               | Mira→Riley handoff brief enrichment before approval park.                                                                                                                             | YES (`inngest.ts:370`).                                                                                                                        |
| `FINANCIAL_AUTO_APPROVE_DENYLIST`         | **Not an env var** — a hard-coded constant | `["adoptimizer.campaign.reallocate", ".scale", ".shift_budget_to_source"]` are never `system_auto_approved`; force human approval even if a spend gate would otherwise short-circuit. | N/A (always on; defense-in-depth) (`packages/core/src/platform/governance/governance-gate.ts:103-107,129`).                                    |

Non-Meta but launch-adjacent: `NEXT_PUBLIC_REPORTS_LIVE=false` (`.env.example:234`) — the
`/reports` UI stays fixture-mode "demo data"; its allowlist rationale is literally
**"Launch blocked on Meta Ads Connection + issue #472"** (`env-allowlist.live-flag-matrix.json:18`).
Auth bypasses for completeness: `ALLOW_SELF_APPROVAL` / `ALLOW_SELF_APPROVAL_IN_PRODUCTION`
(prod boot refuses without the ack), `DEV_BYPASS_AUTH` / `NEXT_PUBLIC_DEV_BYPASS_AUTH`
(non-prod only) — none Meta-specific.

**Bottom line: the money path (Riley reallocate) and the WhatsApp marketing-template path
are BOTH dark by default.** Conversational/utility WA sends are NOT flag-gated — they only
need a token + phone-number-id (env or Connection).

---

## 6. Documented operational gap-to-go-live

From `docs/runbooks/provisioning.md`, `riley-meta-insights-live-verify.md`, the Tier-0 plan,
and the synergy spec — the remaining OPERATIONAL (non-code) steps:

### Central credentials to obtain / mint (one set for all tenants)

1. Meta App (Business type) with: **App ID** (`META_APP_ID` + `NEXT_PUBLIC_META_APP_ID`),
   **App Secret** (`META_APP_SECRET`), **FB Login config for Embedded Signup**
   (`META_CONFIG_ID` + `NEXT_PUBLIC_META_CONFIG_ID`).
2. **System User token** — permanent SUAT (`META_SYSTEM_USER_TOKEN`) + **System User ID**
   (`META_SYSTEM_USER_ID`). Required for Embedded Signup Graph calls + WA template create
   (else HTTP 500 `WHATSAPP_TOKEN_MISSING`, `whatsapp-template-create.ts:106`).
3. **WhatsApp Graph (app) token** (`WHATSAPP_GRAPH_TOKEN`) for `/subscribed_apps` webhook
   registration; **WhatsApp app secret** (`WHATSAPP_APP_SECRET`) for chat webhook verify.
4. **Webhook verify token** (`META_WEBHOOK_VERIFY_TOKEN`, `openssl rand -hex 32`,
   `provisioning.md:32`) — without it the webhook GET handshake throws
   (`ad-optimizer.ts:10`).
5. **OAuth redirect URI** (`META_OAUTH_REDIRECT_URI`) = `https://api.example.com/api/connections/facebook/callback`.
6. (Optional, for CAPI) **Pixel ID** (`META_PIXEL_ID`) + **CAPI token**
   (`META_CAPI_ACCESS_TOKEN`) — both needed or CAPI stays dormant.
7. `CREDENTIALS_ENCRYPTION_KEY` byte-identical on api + chat (`provisioning.md:58`) — stored
   Meta/WA Connections become unreadable otherwise.

### Deploy / wiring (provisioning.md §§1-8)

8. Set the above as Render `sync:false` secrets: `META_SYSTEM_USER_TOKEN`,
   `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_GRAPH_TOKEN`, `META_PIXEL_ID`
   on `switchboard-api` (`provisioning.md:51`); `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
   `WHATSAPP_APP_SECRET` on `switchboard-chat` (`:54`).
9. Set `NEXT_PUBLIC_META_APP_ID` + `NEXT_PUBLIC_META_CONFIG_ID` on Vercel **before first
   build** (NEXT_PUBLIC is build-inlined; `provisioning.md:87`). Else the Embedded Signup
   button is hidden (`connections-list.tsx:346`).
10. Register the WhatsApp/Meta webhook at
    `https://chat.example.com/webhook/managed/<webhookId>` matching
    `META_WEBHOOK_VERIFY_TOKEN` + `META_APP_SECRET` (api) + `WHATSAPP_APP_SECRET` (chat)
    (`provisioning.md:108`).

### Live verification (must pass before relying on Riley money math)

11. Run the **one-time insights live-verify** (`riley-meta-insights-live-verify.md`):
    requires a Tier-0-credentialed org's real system-user token + `act_<id>`; confirm
    `/insights` returns no `status`/`effective_status`/`revenue` keys and that money lives
    in `action_values` (`riley-meta-insights-live-verify.md:35-41`). **If contradicted →
    STOP, do not flip Riley to production.** Currently **BLOCKED on a credentialed org**
    (runbook header: "Blocked-by Tier 0").

### Per-org actions (each pilot clinic)

12. Run `scripts/provision-pilot.mts --email owner@clinic.com` (creates org/owner/Riley;
    **NOT yet run** for any real org). No Meta/WA creds seeded by this — capability only.
13. Operator manually enters Meta Ads credentials in Settings (writes
    `Connection(serviceId="meta-ads")`) so Riley's resolver fallback resolves
    (`riley-credential-resolver.ts:53`; Tier-0 plan PR 0.1).
14. Connect WhatsApp via Embedded Signup (writes encrypted `Connection(serviceId="whatsapp")`,
    `bootstrap/routes.ts:200`) and run a test-connection so `lastHealthCheck` is non-null
    (readiness `channel-connected` requires it, `readiness.ts:366`).

### Feature-flag flips (deliberate, after the above)

15. `FOLLOWUP_ALLOW_MARKETING_TEMPLATE=true` only once a Meta-approved marketing template
    exists (`.env.example:152`).
16. `RILEY_REALLOCATE_SELF_EXECUTION_ENABLED=true` to arm the money path (still parks for
    approval; gated additionally by `FINANCIAL_AUTO_APPROVE_DENYLIST`).
17. `NEXT_PUBLIC_REPORTS_LIVE=true` once the Meta Ads Connection exists and #472 is closed.

### App Review (Meta Tech Provider)

18. Data Deletion callback URL = `https://api.example.com/api/meta/deletion` — handler
    real + registered + HMAC-verified (§3). Submit it in App Review; needs `META_APP_SECRET`
    live.

---

## Net assessment

- **Code/config plumbing for Meta Tech Provider is largely complete and correct:** every
  env var is consumed, allowlisted, and documented; the Data Deletion callback is a real
  signed-request handler, registered and rate-limited; readiness/health probes report
  honestly (red today); the money + marketing-messaging paths are intentionally dark behind
  default-off flags.
- **What is NOT done is operational, not code:** no central Meta credentials are minted; no
  real pilot org has been provisioned (`provision-pilot.mts` shipped, never run); no operator
  has entered Meta Ads creds; the one-time `/insights` live-verify is blocked on a
  credentialed org; the marketing template + money flags are off.
- **No CI-breaking env gaps.** One inert var (`META_CONFIG_ID` server-side) and one
  naming/semantics gotcha (`organizations.ts:380` reads `WHATSAPP_APP_SECRET` under the name
  `verifyToken`) flagged for the code track, neither blocking.
