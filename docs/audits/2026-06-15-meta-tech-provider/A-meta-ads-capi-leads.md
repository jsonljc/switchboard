# Meta Tech Provider readiness — ADS / CAPI / Lead Ads half

**Auditor:** read-only. **Date:** 2026-06-15. **Branch:** feat/receipted-booking-quality-report.
**Scope:** Meta Marketing/Ads API, Conversions API (CAPI), Lead Ads ingestion — server-side.
WhatsApp / Embedded Signup is a separate audit.

Every claim cites `absolute-path:line`. "REAL" = live HTTP to Graph; "MOCK" = test-only fake;
"STUB" = placeholder/no-op/throws; "DARK" = real code disabled by a default-off flag/unset config.

---

## 0. TL;DR verdict

The **read side is real and live-capable today**: a real Graph v21.0 client, a real OAuth
authorization-code → long-lived-token connect flow with HMAC-signed state and org-gating, a real
token-refresh cron, real insights/signal-health/learning reads, and a **real, signature-verified
Lead Ads webhook receiver**. CAPI is real code but **wired off a single global pixel/token env pair**
(not per-tenant). The **money-moving act-leg (budget reallocate, pause) is DARK by default** behind
two env flags that both default `false`; creative-publish is live but only ever creates **PAUSED**
(no-spend) drafts. **No central System-User / Tech-Provider token model exists for ads** — every
tenant carries its own end-user OAuth token. That last point is the single biggest gap versus the
"Meta Tech Provider holding a central System User token" goal.

Demo-ability: **yes-but** — see §7.

---

## 1. Capability matrix

| Capability                            | Graph endpoint / edge                                             | Status                        | Scope needed                                                        | Gating flag / config                                                                                                       | file:line                                                                                                                    |
| ------------------------------------- | ----------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Campaign insights read                | `GET /act_<id>/insights?level=campaign`                           | REAL                          | `ads_read`                                                          | none                                                                                                                       | `packages/ad-optimizer/src/meta-ads-client.ts:192,218`                                                                       |
| Ad-set insights read                  | `GET /act_<id>/insights?level=adset`                              | REAL                          | `ads_read`                                                          | none                                                                                                                       | `meta-ads-client.ts:223,241`                                                                                                 |
| Ad-set config (learning) read         | `GET /act_<id>/adsets`                                            | REAL                          | `ads_read`                                                          | none                                                                                                                       | `meta-ads-client.ts:286`                                                                                                     |
| Account summary                       | `GET /act_<id>`, `/insights`, `/campaigns`                        | REAL                          | `ads_read`                                                          | none                                                                                                                       | `meta-ads-client.ts:335-339`                                                                                                 |
| Campaign read (budget/status)         | `GET /<campaignId>?fields=...`                                    | REAL                          | `ads_read`                                                          | none                                                                                                                       | `meta-ads-client.ts:482,506,544`                                                                                             |
| Account daily spend                   | `GET /act_<id>/insights?date_preset=today`                        | REAL                          | `ads_read`                                                          | none                                                                                                                       | `meta-ads-client.ts:530`                                                                                                     |
| **Budget reallocate (write)**         | `POST /<campaignId> {daily_budget}`                               | **DARK**                      | `ads_management`                                                    | `RILEY_REALLOCATE_SELF_EXECUTION_ENABLED` (default false)                                                                  | `meta-ads-client.ts:456,470`; gate `apps/api/src/bootstrap/inngest.ts:494`                                                   |
| **Campaign pause (write)**            | `POST /<campaignId> {status:PAUSED}`                              | **DARK**                      | `ads_management`                                                    | `RILEY_PAUSE_SELF_EXECUTION_ENABLED` (default false) **AND** per-deployment `governanceSettings.pauseSelfExecutionEnabled` | `meta-ads-client.ts:438,445`; gates `inngest.ts:488` + `inngest.ts:457`                                                      |
| Campaign **activate** (status→ACTIVE) | (would be `POST /<id> {status:ACTIVE}`)                           | **STUB (throws by design)**   | —                                                                   | hard refusal                                                                                                               | `meta-ads-client.ts:438-443` (throws "Agent cannot activate")                                                                |
| Create draft campaign/adset/ad        | `POST /act_<id>/campaigns` `/adsets` `/ads` (all `status:PAUSED`) | REAL (publish path)           | `ads_management`                                                    | creative-publish: no env flag; PAUSED-only                                                                                 | `meta-ads-client.ts:355,369,373,382,423,434`; `apps/api/src/services/creative-publish-function.ts:273-328`                   |
| Upload creative asset                 | `POST /act_<id>/adimages` or `/advideos`                          | REAL                          | `ads_management`                                                    | publish path                                                                                                               | `meta-ads-client.ts:386-397`                                                                                                 |
| Create ad creative                    | `POST /act_<id>/adcreatives`                                      | REAL                          | `ads_management`, `pages_*` (object_story_spec.page_id)             | publish path                                                                                                               | `meta-ads-client.ts:400,419`                                                                                                 |
| OAuth: code → token                   | `GET /oauth/access_token?code=`                                   | REAL                          | (app)                                                               | `META_APP_ID/SECRET/REDIRECT_URI`                                                                                          | `packages/ad-optimizer/src/facebook-oauth.ts:104,114`                                                                        |
| OAuth: long-lived exchange            | `GET /oauth/access_token?grant_type=fb_exchange_token`            | REAL                          | (app)                                                               | same                                                                                                                       | `facebook-oauth.ts:126,136`                                                                                                  |
| List ad accounts                      | `GET /me/adaccounts`                                              | REAL                          | `ads_read`                                                          | same                                                                                                                       | `facebook-oauth.ts:148,153`                                                                                                  |
| Token refresh cron                    | `GET /oauth/access_token` (re-exchange)                           | REAL                          | (app)                                                               | runs daily `0 3 * * *`; needs OAuth app env                                                                                | `apps/api/src/services/cron/meta-token-refresh.ts:94,136-138`                                                                |
| CAPI dispatch (governed)              | `POST /<pixelId>/events`                                          | REAL but **inert by default** | pixel access token (`ads_management` on the pixel / Business token) | `META_PIXEL_ID` + `META_CAPI_ACCESS_TOKEN` (single global; unset ⇒ not wired)                                              | `packages/ad-optimizer/src/meta-capi-dispatcher.ts:126,127`; gate `apps/api/src/bootstrap/conversion-bus-bootstrap.ts:54-57` |
| CAPI dispatch (simpler client)        | `POST /<pixelId>/events`                                          | REAL (helper, see §5)         | same                                                                | `wireCAPIDispatcher(config)` caller-supplied                                                                               | `packages/ad-optimizer/src/meta-capi-client.ts:31,32,57`; `apps/api/src/bootstrap/conversion-bus-wiring.ts:8`                |
| Lead Ads webhook verify               | `GET /leads/webhook` (hub.challenge)                              | REAL                          | `leads_retrieval` (subscription)                                    | `META_WEBHOOK_VERIFY_TOKEN`                                                                                                | `apps/api/src/routes/ad-optimizer.ts:46-64`                                                                                  |
| Lead Ads webhook receive              | `POST /leads/webhook` (X-Hub-Signature-256)                       | REAL                          | `leads_retrieval`                                                   | `META_APP_SECRET` (HMAC verify)                                                                                            | `apps/api/src/routes/ad-optimizer.ts:67-135`                                                                                 |
| Lead detail fetch                     | `GET /<leadgen-id>?fields=...`                                    | REAL                          | `leads_retrieval`                                                   | (token from connection)                                                                                                    | `packages/ad-optimizer/src/meta-leads-ingester.ts:72,77`; wired `apps/api/src/bootstrap/inngest.ts:835`                      |
| Instant-Form → Contact                | (internal `meta.lead.intake` workflow)                            | REAL                          | n/a                                                                 | registered intent                                                                                                          | `apps/api/src/bootstrap/contained-workflows.ts:370,493`                                                                      |
| CTWA (WhatsApp click-to-WA) lead      | (internal `lead.intake` via chat gateway)                         | REAL                          | n/a                                                                 | `apps/chat/src/main.ts:181`                                                                                                | `packages/ad-optimizer/src/lead-intake/ctwa-adapter.ts:81`                                                                   |
| Pixel/CAPI signal health              | `GET /<pixelId>` `/stats` `/da_checks`                            | REAL                          | `ads_read` (+ pixel access)                                         | none                                                                                                                       | `packages/ad-optimizer/src/signal-health-checker.ts:151,169,198,251`                                                         |

Graph version pin: **`https://graph.facebook.com/v21.0`** consistently across all clients
(`meta-ads-client.ts:14`, `facebook-oauth.ts:5`, `meta-capi-client.ts:5`, `meta-capi-dispatcher.ts:6`,
`meta-leads-ingester.ts:70`, `signal-health-checker.ts:8`, `packages/db/src/oauth/token-refresh.ts:5`,
and the SDK init `v21.0` in the authed-only spec). See §6.

---

## 2. Scopes requested vs needed

Authorization requests a fixed scope string (`facebook-oauth.ts:7`):

```
ads_read, ads_management, business_management, pages_manage_metadata, leads_retrieval
```

Mapping to the edges actually touched:

- `ads_read` — every insights/account/campaign GET (§1 read rows). **Used.**
- `ads_management` — budget/pause writes + draft campaign/adset/ad/creative POSTs. **Used** by the
  publish path (live) and the act-leg writes (dark). `facebook-oauth.ts:456,470,438,355,…`.
- `business_management` — requested, but **no edge in the audited ads code reads a Business asset**
  (no `GET /<business-id>/...`, no system-user provisioning). It is the scope you'd need for a
  central-token / owned-asset Tech-Provider model, which does not exist here for ads (§5). Today it
  is requested-but-unexercised for ads.
- `pages_manage_metadata` — requested. The creative POST uses `object_story_spec.page_id`
  (`meta-ads-client.ts:405-407`) and the precondition requires a configured `pageId`
  (`creative-publish-preconditions.ts:103-109`). Page **publishing** of ad creatives generally needs
  `pages_show_list` / `pages_read_engagement` / `ads_management`; `pages_manage_metadata` is a
  narrower grant. **Risk:** the requested page scope may be insufficient for live page-backed
  creatives — verify against App Review for the LEARN_MORE link_data/video_data creative.
- `leads_retrieval` — `GET /<leadgen-id>` and the leadgen webhook subscription. **Used.**
- **CAPI needs no OAuth scope here** — it runs off a _separate_ pixel access token in env
  (`META_CAPI_ACCESS_TOKEN`, §5), not off the connected user token.

---

## 3. OAuth connect flow (numbered, with break points)

Producer/consumer trace for "client connects an ad account":

1. **Authorize URL mint (Bearer-authed).** `GET /api/connections/facebook/authorize?deploymentId=`
   — `apps/api/src/routes/facebook-oauth.ts:31-73`. Loads the deployment, **gates org ownership**
   via `assertOrgAccess(request, deployment.organizationId, reply)` (`facebook-oauth.ts:59`) BEFORE
   minting state. Mints an HMAC-signed `state` binding `deploymentId`+issuedAt
   (`facebook-oauth.ts:65`, signer `facebook-oauth.ts:41-51`). Builds the dialog URL with the fixed
   scopes (`facebook-oauth.ts:90-98`, dialog `https://www.facebook.com/v21.0/dialog/oauth`,
   `facebook-oauth.ts:6`).
2. **Redirect to Facebook.** The dashboard redirects the browser to `authorizeUrl`.
3. **Callback (auth-exempt).** `GET /api/connections/facebook/callback?code&state` —
   `facebook-oauth.ts:84-182`. **No Bearer** (Facebook controls the redirect). Trust rests entirely
   on `verifySignedState` (HMAC + 10-min expiry, `facebook-oauth.ts:110`, verifier
   `facebook-oauth.ts:58-85`). Derives `deploymentId` from the verified state.
4. **Code → short-lived token.** `exchangeCodeForToken` (`facebook-oauth.ts:130` → `:104`).
5. **Short-lived → long-lived (60-day).** `exchangeForLongLivedToken` (`facebook-oauth.ts:133` → `:126`).
6. **List + pick account.** `listAdAccounts(longLived)` then `accounts.find(a => a.status === 1)`
   (`facebook-oauth.ts:136-144`). **Break point:** picks the FIRST active account only — no operator
   account-chooser at connect time; a user with multiple ad accounts gets account[0].status===1
   silently. (A separate `/facebook/:deploymentId/accounts` list route exists at
   `facebook-oauth.ts:185-248` but is not used to _choose_ during connect.)
7. **Encrypt + store.** `encryptCredentials({accessToken, accountId:"act_"+id, accountName,
currency, expiresAt})` → `PrismaDeploymentConnectionStore.create({deploymentId, type:"meta-ads",
credentials, metadata})` (`facebook-oauth.ts:149-167`). Credentials are AES-encrypted blobs.
8. **Token refresh cron.** Daily `0 3 * * *` (`meta-token-refresh.ts:138`). Re-exchanges any
   active meta-ads connection within 7 days of expiry (`meta-token-refresh.ts:88,94`), keeps
   `metadata.expiresAt` in lockstep (`:106-109`), marks `needs_reauth` + alerts on failure
   (`:115-123`). Reads `creds.expiresAt ?? creds.tokenExpiresAt` (`:63`) — the legacy-field fix
   (D10-2) so it does not silently skip every row.

**Required env for the connect flow to function:** `META_APP_ID`, `META_APP_SECRET`,
`META_OAUTH_REDIRECT_URI` (group-resolved, `apps/api/src/utils/meta-oauth-config.ts:11-35`; throws
if any missing), the OAuth-state secret (`oauth-state-secret.ts`), `CREDENTIALS_ENCRYPTION_KEY`, and
`DATABASE_URL`. None are in `.env.example` defaults — they must be supplied to demo.

### Cross-tenant token resolution — investigated, NO live leak found

Memory's "oauth cross-tenant hole" (Riley capability audit, `project_riley_capability_audit_2026_06_10`)
predates the current code; every present-day read site is org-scoped:

- Resolver primary: `listByDeployment(deploymentId)` then `.find(type==="meta-ads")` — deployment id
  is a unique PK bound to exactly one org; consumers re-check `deployment.organizationId ===
organizationId` (`riley-budget-execution-workflow.ts:214-223`, pause `:216-225`,
  `DEPLOYMENT_ORG_MISMATCH`). `apps/api/src/bootstrap/riley-credential-resolver.ts:47-49`.
- Resolver fallback: `orgConnectionStore.findByServiceId("meta-ads", orgId)` — WHERE includes
  `organizationId` (`riley-credential-resolver.ts:51-55`; `resolveOrgId` reads the deployment's own
  org, `inngest.ts:428-431`).
- `buildAdsClientFactory`: WHERE requires **both** `id` AND `organizationId`
  (`apps/api/src/lib/ads-client-factory.ts:35-40`).
- `buildMetaSpendProvider`: WHERE `{organizationId, serviceId:"meta-ads", status:"connected"}`
  (`apps/api/src/lib/meta-spend-provider.ts:51-54`).
- OAuth read route uses `findByDeploymentAndTypeForOrg(callerOrgId, …)` (`facebook-oauth.ts:215`).
- **Callback residual (design, not a code bug):** the callback is auth-exempt and binds the new
  connection to whatever `deploymentId` the signed state carries. Org binding is transitively the
  deployment's org. This is safe _because_ the bearer-authed authorize leg (step 1) gated org
  ownership before signing. The only way to attach a Meta account to a foreign deployment is to
  forge/leak the OAuth-state HMAC secret — a secret-management concern, not a scoping bug.

**Conclusion:** No code path resolves one tenant's ads token in another tenant's context today.
The historical finding appears addressed (it was bundled with the launch auth-trust-binding work).

---

## 4. Act-leg (money-moving) status — DARK by default

Two independent kill switches, **both default `false`** (`.env.example:374,379`,
"Default off: deploy dark"):

- **`RILEY_REALLOCATE_SELF_EXECUTION_ENABLED`** — read at `apps/api/src/bootstrap/inngest.ts:494`:
  ```ts
  ...(process.env["RILEY_REALLOCATE_SELF_EXECUTION_ENABLED"] === "true"
        ? { rileyBudgetSubmitter } : {}),
  ```
  When unset/false, `rileyBudgetSubmitter` is never threaded into the weekly-audit deps, so the sink
  proposes **zero** reallocation candidates (`recommendation-sink.ts:543` is `if
(args.rileyBudgetSubmitter && …)`). **Env-only gate, no per-deployment toggle in v1.**
- **`RILEY_PAUSE_SELF_EXECUTION_ENABLED`** — read at `inngest.ts:488`. **Two layers**: this env flag
  AND a per-deployment `governanceSettings.pauseSelfExecutionEnabled === true`
  (`inngest.ts:457-460`, flipped only by `scripts/riley-pause-flag.ts`). Both must be on.

**Even when the submitter fires, nothing moves money without a human:** the proposed move parks for
mandatory approval (the executor refuses an unapproved unit, `riley-pause-execution-workflow.ts:197-209`
`PAUSE_NOT_APPROVED`; `riley-budget-execution-workflow.ts:158-169` `REALLOCATE_NOT_APPROVED`). Plus a
governance backstop: `FINANCIAL_AUTO_APPROVE_DENYLIST` forces these intents off the
`system_auto_approved` short-circuit into the full policy path even when no spend delta is readable
(`packages/core/src/platform/governance/governance-gate.ts:103-107,129-134,182-192`). The denylist
covers `adoptimizer.campaign.reallocate`, `.scale`, `.shift_budget_to_source`.

**Executor registration is unconditional** (`contained-workflows.ts` registers
`adoptimizer.campaign.pause`, `adoptimizer.campaign.reallocate`, `creative.job.publish` with
`approvalPolicy:"always"`), but the **initiators** are flag-gated, so the executors simply never
receive work while dark. The reallocate executor is a hardened read-modify-re-read with a durable
at-most-once `MetaMutationAttempt` lease, blast-radius cap, drift check, and post-write re-read
(`riley-budget-execution-workflow.ts:118-476`) — this is real, careful code that is simply switched off.

**Activation is structurally impossible:** `updateCampaignStatus` throws on `ACTIVE`
(`meta-ads-client.ts:438-443`); `createAd` hardcodes `status:"PAUSED"` and is the only ad-create path
(`:423-436`). The creative-publish chain only ever creates PAUSED objects (no spend) and never calls
`updateCampaignStatus` (`creative-publish-function.ts:244` comment + chain `:264-328`).

**Money path today: OFF.** Flipping it live requires setting the env flag(s) true in prod AND, for
pause, the per-deployment DB flag — then every move still parks for human approval. Spec status
(`.claude/spec1b-act-leg-loop-state.md`): slices 1B-1.1→1B-2a merged; 1B-2b (paid-value trueROAS) and
the real-money flip + live-Meta verify remain deferred (blocked on the Ledger/deposit-loop work).

---

## 5. "Looks wired but inert" findings (ruthless)

- **CAPI runs off a single GLOBAL pixel + token, not per-tenant.** `conversion-bus-bootstrap.ts:54-57`
  reads `META_PIXEL_ID` + `META_CAPI_ACCESS_TOKEN` from process env and wires ONE
  `MetaCAPIDispatcher` for the whole process. There is no per-org pixel resolution. For a multi-tenant
  Tech Provider this means CAPI either (a) is unwired (both env unset — the default, `.env.example`
  has no entries for them) or (b) fires every tenant's conversions into one operator-owned pixel.
  **Inert by default; architecturally wrong for multi-tenant when on.** `conversion-bus-bootstrap.ts:53-87`.
- **Two CAPI code paths, one is dormant.** `MetaCAPIClient` (`meta-capi-client.ts`) + thin
  `wireCAPIDispatcher` (`conversion-bus-wiring.ts:4-29`, hardcodes `currency:"SGD"`,
  `action_source:"system_generated"`) coexists with the richer governed `MetaCAPIDispatcher`. The
  bootstrap wires the latter; `wireCAPIDispatcher` has no production caller found. Plus
  `outcome-wiring.ts:1-9` carries a `TODO(post-wedge): OutcomeDispatcher must REPLACE … MetaCAPIDispatcher`
  — an unfinished migration. Dead/duplicate surface area.
- **`business_management` scope requested but unexercised for ads** (§2). No Business-asset read, no
  system-user provisioning in the ads code. Requesting a scope you don't use is an App Review smell.
- **Connect picks account[0].status===1 silently** (`facebook-oauth.ts:137-144`). A real operator
  with multiple ad accounts cannot choose; no UI account-selection at connect.
- **`getTargetBreachStatus` snapshots branch is DORMANT** — the audit-runner never passes `snapshots`,
  so the weekly-snapshot path is unfed (author-flagged, fail-safe). `meta-campaign-insights-provider.ts:117-126`.
- **`packages/db/src/oauth/token-refresh.ts` is a SECOND, divergent refresh implementation** that
  expects a `refreshToken` field and `appId/appSecret` _inside_ creds (`token-refresh.ts:24-34`),
  writes `status:"connected"` and `tokenExpiresAt`. The ACTIVE cron is
  `apps/api/src/services/cron/meta-token-refresh.ts` (uses `expiresAt`, `status:"needs_reauth"`,
  Inngest). The db-layer one looks orphaned/legacy relative to the OAuth callback's credential shape
  (which stores `accessToken`+`expiresAt`, no `refreshToken`). Confirm it has no live caller before
  trusting either; field-shape drift between the two is a latent footgun.
- **Lead webhook org resolution depends on `Connection.externalAccountId` being populated.**
  `ad-optimizer.ts:92-101` resolves org by `serviceId:"meta-ads", externalAccountId: entryId`. The
  OAuth callback stores `metadata.accountId` and creds, but I did not find it writing
  `externalAccountId` on the connection row (callback uses `PrismaDeploymentConnectionStore`, the
  webhook reads `Connection`). **If `externalAccountId` is never set on the org-level `Connection`,
  every live lead webhook resolves `no_org` and is skipped** (`ad-optimizer.ts:104-106`). This is a
  producer/consumer seam to verify against a real connected org before relying on Lead Ads.
- **CAPI `action_source` mismatch risk:** `meta-capi-client.ts:53` hardcodes
  `action_source:"system_generated"` for all events; `meta-capi-dispatcher.ts:78-91` infers crm/website/
  system_generated. Mixed conventions across the two clients.

---

## 6. Graph version & deprecation risk

- **Pinned to v21.0 everywhere** (§1). v21.0 was released ~Oct 2024; Meta deprecates Graph versions
  ~2 years after release, so v21.0 is on track to sunset in **late 2026**. For a Tech Provider going
  through App Review now, plan a bump to a current version (v23+) — the pin is centralized as a const
  per file (no single shared constant), so a bump touches ~7 files: `meta-ads-client.ts:14`,
  `facebook-oauth.ts:5-6`, `meta-capi-client.ts:5`, `meta-capi-dispatcher.ts:6`,
  `meta-leads-ingester.ts:70`, `signal-health-checker.ts:8`, `packages/db/src/oauth/token-refresh.ts:5`,
  plus the dashboard SDK `version:"v21.0"`.
- **`/insights` field-set assumption is unverified against a real account.** PR 1.1 removed
  `status`/`effective_status`/`revenue` from the requested fields (they don't exist on `/insights`)
  and sources revenue from `action_values` (`meta-ads-client.ts:66-93,671`). The live verification is
  still a **manual, never-run** runbook (`docs/runbooks/riley-meta-insights-live-verify.md`) blocked
  on a credentialed pilot org. If Meta's real shape differs, the money math in the audit changes.
- **Deprecated edge risk:** `/<pixelId>/stats` and `da_checks` (`signal-health-checker.ts:171,252`)
  are pre-Conversions-API-era Pixel edges; their availability/shape on v21+ for a given pixel should be
  live-verified. `omni_purchase` dedup logic (`meta-ads-client.ts:78-93`) is current and correct.

---

## 7. Demo-ability verdict — could we screencast a real user connecting an ad account and pulling live insights TODAY?

**Verdict: yes-but-needs-X.** The code path exists end-to-end and is REAL; what's missing is
configuration and one UI seam, not engineering.

**What works today (real, live HTTP):** authorize → Facebook OAuth dialog → callback → code→token →
long-lived exchange → list ad accounts → encrypt+store connection → daily refresh cron; and reading
live campaign insights via `MetaAdsClient` (the dashboard reports route already constructs a real
client, `apps/api/src/routes/dashboard-reports.ts:46`). The Lead Ads webhook is a real signature-
verified receiver. None of the read/connect path is mocked or flagged off.

**Concrete blockers to record a clean demo:**

1. **Set OAuth app env** in the demo deployment: `META_APP_ID`, `META_APP_SECRET`,
   `META_OAUTH_REDIRECT_URI` (else `meta-oauth-config.ts:25-31` throws), plus
   `CREDENTIALS_ENCRYPTION_KEY`, `DATABASE_URL`, the OAuth-state secret, `DASHBOARD_URL`.
2. **A real Meta App** with `ads_read`/`ads_management` granted (advanced access needs App Review;
   for a personal/dev-mode demo, the app's own admin/dev/test users can authorize without review).
3. **The dashboard "Connect" UI must server-proxy the Bearer-authed authorize route** — confirm the
   `/connections` page calls `/api/connections/facebook/authorize` and follows the redirect (the route
   is Bearer-authed by design). This is the WhatsApp-audit's surface but the ads connect button rides
   the same page; verify the proxy route exists (memory flags "dashboard→API needs a Next proxy route").
4. **Account selection:** the connect flow auto-picks account[0].status===1; for a believable demo use
   a Facebook user whose first active ad account is the intended one, or accept the auto-pick.
5. **Insights to display:** the audited insights reads are real; ensure the demo org's connection
   `Connection.externalAccountId`/credentials are populated so the report route resolves the client
   (and, separately, so the lead webhook can resolve org — §5).

**What you CANNOT honestly demo today:** a live money move (budget change / pause) — that path is DARK
(§4) and would require flipping `RILEY_REALLOCATE_SELF_EXECUTION_ENABLED` / pause flags plus a human
approval; and a central System-User / Tech-Provider token managing _other businesses'_ accounts — that
model does not exist for ads (every tenant uses its own end-user OAuth token, §5). CAPI can be demoed
only against a single operator-owned pixel via `META_PIXEL_ID`/`META_CAPI_ACCESS_TOKEN`, not per-client.

**Bottom line for App Review:** you can record a real logged-in user connecting their own Meta ad
account and the app pulling their live insights, once the app env + a reviewable Meta App are in place.
You should NOT claim "manage client accounts via a central System User token" — that is unbuilt for
ads. Scope the App Review submission to the OAuth-connect + read (ads_read) + Lead Ads (leads_retrieval)
surfaces that are genuinely live, and treat ads_management/business_management as future once the
act-leg flips and a Business-asset model is built.
