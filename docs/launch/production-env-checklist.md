# Production Environment Variable Checklist

**Status:** launch-readiness reference. Code is launch-complete; the remaining gate
is **setting these values in the deploy hosts**. Every var below is already read
correctly by the code — it is inert until populated in the right dashboard.

**Deploy topology**

- `apps/dashboard` — Next.js 14 on **Vercel**.
- `apps/api` (Fastify) + `apps/chat` — on **Render** (confirmed from `.env.example`
  comments: _"Set on the `api` service in Render"_, _"the public Render URL of the
  api service"_). The two share one env scope per service; treat "API host" below as
  the Render `api` service (and `chat` service where a channel adapter is involved).

**How to read the tables**

- **Set on** — `Vercel` (dashboard), `API host` (Render api/chat), or `both`.
- **`NEXT_PUBLIC` build-time?** — `yes` means the value is **inlined at build time**.
  Changing it requires a **redeploy** of the dashboard, not just an env edit. (See Gotchas.)
- **Secret?** — `yes` = never log, never commit, rotate on leak.
- **Launch?** — `required` to ship, or `optional`/per-feature.

> ⚠️ **Do not let me (or anyone) paste real secret values into the repo.** Populate
> values directly in the Vercel / Render dashboards. This file is the list only.

---

## 0. The four SILENT-failure groups (read these first)

These break a feature with **no error** — the app returns 200s / renders / boots fine,
the capability is just dark. They are the highest-risk omissions because nothing alarms.

| If you forget…                                                                         | Symptom (no error surfaced)                                                                                                                                                                                                                   | Confirmed at                                                                                                    |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **`RESEND_API_KEY`** (+ `EMAIL_FROM`)                                                  | No verification, password-reset, or booking-confirmation emails. **Password reset still returns 200** and shows "check your email"; the email never sends. Only a `console.warn` in logs.                                                     | `apps/dashboard/src/lib/email.ts:36,112`; `apps/api/src/bootstrap/calendar-provider-factory.ts:120`             |
| **`INTERNAL_API_SECRET`** + **`CHAT_PUBLIC_URL`**                                      | Channel provisioning (Telegram/WhatsApp/Slack) silently stalls — webhook base URL falls back to `http://localhost:3001` and the internal secret is `undefined`, so managed channels sit stuck in **"provisioning"** and never reach "active". | `apps/api/src/bootstrap/routes.ts:160-162`; `apps/api/src/routes/organizations.ts:364-365`                      |
| **`NEXT_PUBLIC_STRIPE_ENABLED`** + **`STRIPE_PRICE_*` / `NEXT_PUBLIC_STRIPE_PRICE_*`** | Billing/upgrade UI is simply **hidden** — the Settings → Billing nav item and price cards don't render. No error; users just can't upgrade.                                                                                                   | `apps/dashboard/src/components/layout/settings-layout.tsx:8`; `apps/dashboard/.../settings/billing/page.tsx:26` |
| **`SENTRY_DSN_SERVER`** + **`NEXT_PUBLIC_SENTRY_DSN`**                                 | Error monitoring is **dark**. Sentry init is "gracefully skipped if not set" — exceptions in prod go uncaptured.                                                                                                                              | `apps/api/src/bootstrap` + `apps/chat/src/bootstrap`; dashboard client                                          |

---

## 1. Core platform — required for the app to boot at all

| Var                          | Gates what                                                   | Breaks if unset                                                                   | Set on   | NEXT_PUBLIC build-time? | Secret?            | Launch?  |
| ---------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------- | -------- | ----------------------- | ------------------ | -------- |
| `DATABASE_URL`               | Postgres connection (Prisma) for api, chat, dashboard server | Nothing works; boot fails / all data calls error                                  | both     | no                      | yes                | required |
| `REDIS_URL`                  | Rate limiting, idempotency, BullMQ                           | Rate-limit/idempotency/queue features degrade or fail                             | API host | no                      | yes (if pw in URL) | required |
| `CREDENTIALS_ENCRYPTION_KEY` | Encrypts stored connection credentials (OAuth tokens, etc.)  | Connection storage/decryption fails — channels & integrations can't persist creds | API host | no                      | yes                | required |
| `ANTHROPIC_API_KEY`          | All agent/LLM reasoning (Alex/Riley/Mira)                    | Agents can't run; classification & generation fail                                | API host | no                      | yes                | required |
| `SESSION_TOKEN_SECRET`       | Session-scoped JWT for API session auth                      | Session auth breaks (≥32 chars recommended)                                       | API host | no                      | yes                | required |
| `NODE_ENV`                   | `production` everywhere live                                 | Wrong logging/limits; **do NOT gate security on this alone** (see Gotchas)        | both     | no                      | no                 | required |

---

## 2. Dashboard auth & URLs (Vercel)

| Var                                  | Gates what                                                                                              | Breaks if unset                                                                                                                                 | Set on | NEXT_PUBLIC build-time? | Secret? | Launch?                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------- | ------- | ---------------------------- |
| `NEXTAUTH_SECRET`                    | NextAuth session/JWT signing                                                                            | Login/session breaks; sessions invalid                                                                                                          | Vercel | no                      | yes     | required                     |
| `NEXTAUTH_URL`                       | NextAuth callback base (canonical prod dashboard URL)                                                   | OAuth callbacks & redirects break                                                                                                               | Vercel | no                      | no      | required                     |
| `NEXT_PUBLIC_APP_URL`                | Browser-visible dashboard base URL                                                                      | Self-referential links/redirects wrong                                                                                                          | Vercel | **yes**                 | no      | required                     |
| `NEXT_PUBLIC_API_URL`                | Browser-visible API base (note: browser calls are proxied server-side, but this is still inlined)       | Any client code referencing it gets wrong/empty base                                                                                            | Vercel | **yes**                 | no      | required                     |
| `SWITCHBOARD_API_URL`                | **Server-side** base URL the dashboard's Next API routes call (the Render api URL). NOT `NEXT_PUBLIC_`. | "Unable to load dashboard data" — every proxied call fails                                                                                      | Vercel | no                      | no      | required                     |
| `NEXT_PUBLIC_DEPLOY_ENV`             | UI environment label (`production`)                                                                     | Cosmetic; shows wrong env chip                                                                                                                  | Vercel | **yes**                 | no      | optional                     |
| `NEXT_PUBLIC_LAUNCH_MODE`            | Registration mode: `waitlist` / `beta` / `public`                                                       | Wrong signup gate (repo default `public` = open signup)                                                                                         | Vercel | **yes**                 | no      | required (set intentionally) |
| `DEV_BYPASS_AUTH`                    | Server-side auth bypass for local dev                                                                   | **Must be UNSET in prod.** Guarded (`dev-auth.ts` throws if `="true"`, and is inert when `NODE_ENV==="production"`), but leave unset to be safe | Vercel | no                      | no      | **must be unset**            |
| `NEXT_PUBLIC_GOOGLE_AUTH_CONFIGURED` | Shows "Sign in with Google" button                                                                      | Button hidden (fine if Google OAuth not configured)                                                                                             | Vercel | **yes**                 | no      | optional                     |

---

## 3. Email — Resend (SILENT failure if unset)

| Var                                    | Gates what                                                | Breaks if unset                                                         | Set on                                                          | NEXT_PUBLIC build-time? | Secret?        | Launch?             |
| -------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------- | -------------- | ------------------- |
| `RESEND_API_KEY`                       | Verification, password-reset, booking-confirmation emails | **Silent** — reset returns 200, no email sent (`console.warn` only)     | both (dashboard sends reset/verify; api sends booking confirms) | no                      | yes            | required for launch |
| `EMAIL_FROM`                           | From-address on outbound mail                             | Falls back to `noreply@switchboard.app` (may fail Resend domain verify) | both                                                            | no                      | no             | required for launch |
| `NEXT_PUBLIC_SMTP_CONFIGURED`          | Shows magic-link UI option                                | Magic-link UI hidden (credentials login still works)                    | Vercel                                                          | **yes**                 | no             | optional            |
| `EMAIL_SERVER_HOST/PORT/USER/PASSWORD` | SMTP magic-link provider (alternative to Resend)          | Magic link unavailable; credentials login unaffected                    | Vercel                                                          | no                      | yes (PASSWORD) | optional            |

---

## 4. Channel provisioning & chat wiring (SILENT failure if unset)

| Var                                                                                                                      | Gates what                                                                         | Breaks if unset                                                                 | Set on                         | NEXT_PUBLIC build-time? | Secret? | Launch?                                  |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------ | ----------------------- | ------- | ---------------------------------------- |
| `INTERNAL_API_SECRET`                                                                                                    | api→chat internal auth during channel provisioning                                 | **Silent** — provisioning can't authenticate; channels stuck "provisioning"     | both (api sets, chat verifies) | no                      | yes     | required for channels                    |
| `INTERNAL_SETUP_SECRET`                                                                                                  | Internal setup endpoint guard                                                      | Setup endpoints unprotected/unusable                                            | API host                       | no                      | yes     | required for channels                    |
| `CHAT_PUBLIC_URL`                                                                                                        | Public chat origin for webhook base + embed snippets                               | **Silent** — falls back to `http://localhost:3001`; webhooks point at localhost | API host                       | no                      | no      | required for channels                    |
| `CHAT_SERVER_URL`                                                                                                        | Public chat origin for widget embed / provision-complete URLs                      | Embed snippets/URLs wrong                                                       | API host                       | no                      | no      | required for channels                    |
| `SWITCHBOARD_CHAT_URL`                                                                                                   | Server-to-server chat URL for api provision flows (fallback for `CHAT_PUBLIC_URL`) | Provision flows can't reach chat                                                | API host                       | no                      | no      | required for channels                    |
| `CHAT_PORT`                                                                                                              | Chat server listen port                                                            | Wrong port (Render usually injects `PORT`)                                      | API host (chat)                | no                      | no      | optional                                 |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_WEBHOOK_SECRET`                                                                         | Telegram channel                                                                   | Telegram channel inactive                                                       | API host (chat)                | no                      | yes     | per-channel                              |
| `SLACK_BOT_TOKEN` / `SLACK_SIGNING_SECRET`                                                                               | Slack channel (signing secret verifies inbound webhooks)                           | Slack channel inactive / webhook verify fails                                   | API host (chat)                | no                      | yes     | per-channel                              |
| `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_APP_SECRET` / `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_GRAPH_TOKEN` | WhatsApp Cloud API channel                                                         | WhatsApp channel inactive                                                       | API host                       | no                      | yes     | per-channel (blocked on Meta App Review) |

---

## 5. Billing — Stripe (SILENT failure / hidden UI if unset)

| Var                                                    | Gates what                                   | Breaks if unset                                                                                 | Set on   | NEXT_PUBLIC build-time? | Secret? | Launch?                  |
| ------------------------------------------------------ | -------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------- | ----------------------- | ------- | ------------------------ |
| `STRIPE_SECRET_KEY`                                    | Server-side Stripe API (checkout, customers) | `stripe-service.ts` **throws** when a billing call is made (`STRIPE_SECRET_KEY not configured`) | API host | no                      | yes     | required if billing live |
| `STRIPE_WEBHOOK_SECRET`                                | Verifies Stripe webhook signatures           | Webhook handler **throws** (`STRIPE_WEBHOOK_SECRET not configured`)                             | API host | no                      | yes     | required if billing live |
| `NEXT_PUBLIC_STRIPE_ENABLED`                           | Whether billing UI renders at all            | **Silent** — Billing nav + cards hidden                                                         | Vercel   | **yes**                 | no      | required if billing live |
| `NEXT_PUBLIC_STRIPE_PRICE_STARTER` / `_PRO` / `_SCALE` | Browser price IDs on upgrade cards           | **Silent** — price cards render empty `priceId` (checkout can't start)                          | Vercel   | **yes**                 | no      | required if billing live |
| `STRIPE_PRICE_STARTER` / `_PRO` / `_SCALE`             | Server-side price IDs (checkout session)     | Server can't map plan→price                                                                     | API host | no                      | no      | required if billing live |

> **Pairing note:** the `NEXT_PUBLIC_STRIPE_PRICE_*` (browser) and `STRIPE_PRICE_*`
> (server) sets must hold the **same** Stripe price IDs. Set both, on both hosts respectively.

---

## 6. Monitoring & telemetry (SILENT/dark if unset)

| Var                                                            | Gates what                                 | Breaks if unset                                                 | Set on   | NEXT_PUBLIC build-time? | Secret?                      | Launch?              |
| -------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------- | -------- | ----------------------- | ---------------------------- | -------------------- |
| `SENTRY_DSN_SERVER`                                            | Server-side Sentry (api + chat)            | **Silent** — server errors uncaptured (init gracefully skipped) | API host | no                      | yes (treat DSN as sensitive) | strongly recommended |
| `NEXT_PUBLIC_SENTRY_DSN`                                       | Browser-side Sentry (dashboard)            | **Silent** — client errors uncaptured                           | Vercel   | **yes**                 | no                           | strongly recommended |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                                  | OpenTelemetry export target                | No traces exported (gracefully skipped)                         | API host | no                      | no                           | optional             |
| `OTEL_SERVICE_NAME`                                            | OTel service label                         | Defaults to `switchboard`                                       | API host | no                      | no                           | optional             |
| `ALERT_WEBHOOK_URL`                                            | Chat health alerts on channel active↔error | No health alerts                                                | API host | no                      | yes                          | optional             |
| `OPERATOR_ALERT_WEBHOOK_URL` / `OPERATOR_ALERT_WEBHOOK_SECRET` | Operator alert webhook (HMAC-signed)       | No operator alerts                                              | API host | no                      | yes                          | optional             |

---

## 7. Meta / WhatsApp Tech Provider / Ads (Meta-gated)

These unblock alongside the Meta Business Verification + App Review gates.

| Var                                                                 | Gates what                                               | Breaks if unset                                 | Set on                               | NEXT_PUBLIC build-time? | Secret?      | Launch?                        |
| ------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------- | ------------------------------------ | ----------------------- | ------------ | ------------------------------ |
| `META_SYSTEM_USER_TOKEN`                                            | Permanent SUAT for all client WABAs (server Graph calls) | WhatsApp Embedded Signup / WABA management fail | API host                             | no                      | yes          | required for WhatsApp          |
| `META_SYSTEM_USER_ID`                                               | System User ID for `assigned_users` calls                | WABA assignment fails                           | API host                             | no                      | no           | required for WhatsApp          |
| `META_APP_ID` / `META_APP_SECRET`                                   | Meta App identity + webhook signature verification       | Embedded Signup + webhook verify fail           | API host                             | no                      | yes (SECRET) | required for WhatsApp          |
| `NEXT_PUBLIC_META_APP_ID`                                           | Browser JS SDK app id (Embedded Signup)                  | Signup widget can't init                        | Vercel                               | **yes**                 | no           | required for WhatsApp          |
| `NEXT_PUBLIC_META_CONFIG_ID`                                        | Browser FB Login config id (Embedded Signup)             | Signup widget can't init                        | Vercel                               | **yes**                 | no           | required for WhatsApp          |
| `META_GRAPH_VERSION`                                                | Graph API version pin                                    | Defaults to `v21.0`                             | API host                             | no                      | no           | optional                       |
| `META_OAUTH_REDIRECT_URI`                                           | Override OAuth redirect (Inngest provisioning)           | Uses default redirect                           | API host                             | no                      | no           | optional                       |
| `META_WEBHOOK_VERIFY_TOKEN`                                         | Meta webhook GET handshake token                         | Webhook subscription verify fails               | API host                             | no                      | yes          | required for WhatsApp webhooks |
| `META_CAPI_ACCESS_TOKEN`                                            | Conversions API token (bootstrap conversion bus)         | Conversion events not sent                      | API host                             | no                      | yes          | optional (CAPI)                |
| `META_PIXEL_ID`                                                     | Browser-side pixel events (public-safe id)               | Pixel events not fired                          | both (pixel id surfaced client-side) | no                      | no           | optional                       |
| `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` / `FACEBOOK_REDIRECT_URI` | Meta Ads OAuth connection flow                           | Ad-account connect fails                        | API host                             | no                      | yes (SECRET) | required for Meta Ads connect  |

---

## 8. AI / creative providers

| Var                               | Gates what                                      | Breaks if unset                                                             | Set on   | NEXT_PUBLIC build-time? | Secret? | Launch?            |
| --------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------- | -------- | ----------------------- | ------- | ------------------ |
| `OPENAI_API_KEY`                  | Storyboard reference-image generation           | That stage skipped                                                          | API host | no                      | yes     | optional           |
| `VOYAGE_API_KEY`                  | Real KB embeddings (zero-vector stubs if unset) | Degraded retrieval (stubs)                                                  | API host | no                      | yes     | optional           |
| `KLING_API_KEY`                   | Creative pipeline video generation (Stage 5)    | Video gen disabled                                                          | API host | no                      | yes     | optional           |
| `ELEVENLABS_API_KEY`              | Creative pipeline voice synthesis               | Voice gen disabled                                                          | API host | no                      | yes     | optional           |
| `CREATIVE_PIPELINE_ALLOWED_HOSTS` | SSRF allowlist for outbound media downloads     | Defaults to `*.amazonaws.com`/`*.cloudfront.net`; **narrow to your bucket** | API host | no                      | no      | recommended to set |

---

## 9. Async jobs — Inngest (REQUIRED in prod, consumed by the SDK not our code)

Both keys are **required** in production (Inngest Cloud) and are read by the Inngest
SDK internally — they will **not** appear in a `process.env` grep of our source.

| Var                   | Gates what                      | Breaks if unset                                         | Set on   | NEXT_PUBLIC build-time? | Secret? | Launch?         |
| --------------------- | ------------------------------- | ------------------------------------------------------- | -------- | ----------------------- | ------- | --------------- |
| `INNGEST_EVENT_KEY`   | Sending events to Inngest Cloud | Async jobs (provisioning, creative pipeline) don't fire | API host | no                      | yes     | required (prod) |
| `INNGEST_SIGNING_KEY` | Verifying Inngest → app calls   | Inngest can't invoke functions                          | API host | no                      | yes     | required (prod) |

---

## 10. Live-flag matrix (`NEXT_PUBLIC_*_LIVE`) — Vercel, build-time

Read dynamically via `apps/dashboard/src/lib/route-availability.ts`
(`process.env[TOOLS_LIVE_ENV[id]]`). All are **build-time inlined** → **redeploy** after change.
Repo defaults come from `scripts/env-allowlist.live-flag-matrix.json`.

| Var                            | Repo default | Live value for launch                        | Notes                                                                                                                                                                                             |
| ------------------------------ | ------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_CONTACTS_LIVE`    | `true`       | **VERIFY on Vercel**                         | ⚠️ Repo default is `true`, but the live Vercel value may differ (contacts pipeline was fixture-mode pending `NEXT_PUBLIC_CONTACTS_LIVE=true`). **Confirm the actual Vercel value before launch.** |
| `NEXT_PUBLIC_AUTOMATIONS_LIVE` | `true`       | `true`                                       | Backend shipped                                                                                                                                                                                   |
| `NEXT_PUBLIC_ACTIVITY_LIVE`    | `true`       | `true`                                       | Audit-log surface                                                                                                                                                                                 |
| `NEXT_PUBLIC_APPROVALS_LIVE`   | `true`       | `true`                                       | First-class per DOCTRINE                                                                                                                                                                          |
| `NEXT_PUBLIC_REPORTS_LIVE`     | `false`      | `false` until Meta Ads Connection row exists | Reports page shows a "demo data" banner while `false`                                                                                                                                             |

---

## 11. Governance / rate-limit / ops tuning (have safe defaults — optional)

All optional; documented in `.env.example` with sensible defaults. Set on **API host**.
Non-secret unless noted.

`PORT`, `HOST`, `CHAT_PORT`, `ENABLE_SWAGGER`, `CORS_ORIGIN`, `LOG_LEVEL`,
`RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`, `WEBHOOK_RATE_LIMIT_MAX`,
`WEBHOOK_RATE_LIMIT_WINDOW_MS`, `APPROVAL_HTTP_RATE_LIMIT_MAX/_WINDOW_MS`,
`EXECUTE_HTTP_RATE_LIMIT_MAX/_WINDOW_MS`, `APPROVAL_RATE_LIMIT_MAX/_WINDOW_MS`,
`RECOMMENDATION_ACT_RATE_LIMIT_MAX/_WINDOW_MS`, `MAX_CONCURRENT_SESSIONS`,
`DB_KEY_CACHE_TTL_MS`, `API_KEYS`, `API_KEY_METADATA`, `ALLOW_SELF_APPROVAL` (keep
unset/false in prod), `ESCALATION_CHAT_ID`, `ESCALATION_EMAIL`,
`ESCALATION_EMAIL_RECIPIENTS`, `ESCALATION_NOTIFY_ON_BREACH`, `ESCALATION_SLA_MINUTES`,
`ORGANIZATION_ID`, `SKILL_SLUG`, `SWITCHBOARD_API_KEY`, `RILEY_OUTCOME_ATTRIBUTION_ENABLED`
(kill-switch, default false), `DASHBOARD_URL`.

Google Calendar (optional, enables real booking for Alex): `GOOGLE_CALENDAR_CLIENT_ID`,
`GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_REDIRECT_URI`,
`GOOGLE_CALENDAR_CREDENTIALS`, `GOOGLE_CALENDAR_ID`. Google sign-in (optional):
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

---

## 12. Cross-check findings (`.env.example` ↔ code ↔ allowlists)

Source of truth: a `process.env` grep of `apps/**` + `packages/**` (excluding
`node_modules`/`.next`/`dist`), `.env.example`, and
`scripts/env-allowlist.local-readiness.json`.

### A. Consumed in code but **NOT documented in `.env.example`**

- `EVAL`, `EVAL_FAIL_ON_THRESHOLD`, `EVAL_HAIKU_MODEL`, `EVAL_SONNET_MODEL` —
  classifier eval harness (`packages/core/src/governance/classifier/eval/run-eval.ts`).
  **Dev/CI-only, not a launch var.** Recommend adding them to the allowlist's
  `test_only` bucket so the completeness checker stays honest.
- `NEXT_PHASE`, `VERCEL_ENV` — framework/platform-managed (Next build phase / Vercel).
  Not operator-set. `VERCEL_ENV` is already in the allowlist's `production_managed` bucket.

### B. Allowlist is **missing vars that code reads and `.env.example` documents**

The CI completeness checker (`check-env-completeness.ts`) does **not** list these in
`required_in_env_example`, yet they are consumed and documented:

- `NEXT_PUBLIC_SENTRY_DSN` (dashboard client read)
- `CREATIVE_PIPELINE_ALLOWED_HOSTS` (packages/creative-pipeline)
- `ELEVENLABS_API_KEY` (packages/creative-pipeline)

→ **Action:** verify the checker's scan scope — it appears to miss `packages/creative-pipeline`
and dashboard client (`NEXT_PUBLIC_*`) reads. Add the three to the allowlist. (Non-blocking
for launch, but the allowlist is currently giving false confidence.)

### C. Documented in `.env.example` but **NOT consumed anywhere** (dead/superseded — safe to ignore, candidates for cleanup)

- `META_ADS_ACCESS_TOKEN`, `META_ADS_ACCOUNT_ID` — superseded by the
  `META_SYSTEM_USER_TOKEN`/`META_SYSTEM_USER_ID` + `META_CAPI_ACCESS_TOKEN` path. **Do not rely on these.**
- `WHATSAPP_VERIFY_TOKEN` — superseded by `META_WEBHOOK_VERIFY_TOKEN` (the live webhook verify token).
- `CHAT_INTERNAL_URL` — superseded by `CHAT_SERVER_URL` / `SWITCHBOARD_CHAT_URL` / `CHAT_PUBLIC_URL`.
- `NEXT_PUBLIC_DEV_BYPASS_AUTH` — dead; only the **server-side** `DEV_BYPASS_AUTH` is read.
- `META_CONFIG_ID` — only the `NEXT_PUBLIC_META_CONFIG_ID` variant is read; the bare server var is unused.
- `DASHBOARD_PORT` — unused (Next uses `PORT`).
- `SLACK_SIGNING_SECRET` — read indirectly by the Slack adapter (config wrapper, not a
  direct `process.env` literal) — **it is live**; listed here only because it evaded the literal grep.

### D. Compose/host-managed (not app-read — do NOT set on Vercel)

`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `REDIS_PASSWORD` — used only by
docker-compose to construct `DATABASE_URL`/`REDIS_URL`. On managed Postgres/Redis
(Render add-ons or external), the credentials are already encoded in `DATABASE_URL` /
`REDIS_URL`; you do not set these separately.

---

## 13. Known gotchas (heed when populating)

1. **`NEXT_PUBLIC_*` are build-time inlined.** Next.js bakes them into the bundle at
   build. Editing the value in Vercel **without redeploying does nothing** — you must
   **trigger a redeploy** after changing any `NEXT_PUBLIC_*`. This applies to every
   `NEXT_PUBLIC_*` row above (Stripe price IDs, Sentry DSN, Meta app/config ids, the
   `*_LIVE` flags, app URLs, launch mode).
2. **`NODE_ENV === "production"` on Vercel _previews_ too.** Preview deployments report
   `production`. **Do not gate security/secrets on `NODE_ENV` alone** — use an explicit
   allow flag (e.g. a dedicated `ALLOW_*` / `NEXT_PUBLIC_DEPLOY_ENV` check). Preview
   builds will otherwise behave like prod.
3. **`DEV_BYPASS_AUTH` must be UNSET in prod.** There is a guard (`dev-auth.ts` throws
   if `="true"`, and the bypass is inert when `NODE_ENV==="production"`), but leave it
   unset on both hosts — don't rely on the guard.
4. **`NEXT_PUBLIC_CONTACTS_LIVE` repo default (`true`) may differ from the live Vercel
   value.** Contacts shipped fixture-mode pending an explicit flip. **Verify the actual
   value set in the Vercel project** before launch — don't assume the repo default.
5. **Server vs browser API URL split.** `SWITCHBOARD_API_URL` (server, the Render api
   URL) is what the dashboard's Next API routes actually call; `NEXT_PUBLIC_API_URL` is
   browser-visible. Getting `SWITCHBOARD_API_URL` wrong yields the "Unable to load
   dashboard data" failure with no obvious cause.
6. **Stripe price IDs come in pairs** — `NEXT_PUBLIC_STRIPE_PRICE_*` (Vercel, browser)
   and `STRIPE_PRICE_*` (Render, server) must hold the same IDs.

---

## 14. Minimal launch set (paste-ready grouping)

**Vercel (dashboard):**

```
DATABASE_URL=
NEXTAUTH_SECRET=
NEXTAUTH_URL=
NEXT_PUBLIC_APP_URL=
NEXT_PUBLIC_API_URL=
SWITCHBOARD_API_URL=
NEXT_PUBLIC_DEPLOY_ENV=production
NEXT_PUBLIC_LAUNCH_MODE=public
RESEND_API_KEY=
EMAIL_FROM=
NEXT_PUBLIC_SENTRY_DSN=
NEXT_PUBLIC_CONTACTS_LIVE=        # VERIFY intended value
NEXT_PUBLIC_AUTOMATIONS_LIVE=true
NEXT_PUBLIC_ACTIVITY_LIVE=true
NEXT_PUBLIC_APPROVALS_LIVE=true
NEXT_PUBLIC_REPORTS_LIVE=false
# Billing (if live): NEXT_PUBLIC_STRIPE_ENABLED=true + NEXT_PUBLIC_STRIPE_PRICE_STARTER/PRO/SCALE
# WhatsApp (when Meta-approved): NEXT_PUBLIC_META_APP_ID, NEXT_PUBLIC_META_CONFIG_ID
# (leave DEV_BYPASS_AUTH UNSET)
```

**Render (api + chat):**

```
DATABASE_URL=
REDIS_URL=
CREDENTIALS_ENCRYPTION_KEY=
ANTHROPIC_API_KEY=
SESSION_TOKEN_SECRET=
NODE_ENV=production
RESEND_API_KEY=
EMAIL_FROM=
INTERNAL_API_SECRET=
INTERNAL_SETUP_SECRET=
CHAT_PUBLIC_URL=
CHAT_SERVER_URL=
SWITCHBOARD_CHAT_URL=
SENTRY_DSN_SERVER=
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=
CREATIVE_PIPELINE_ALLOWED_HOSTS=    # narrow to your media bucket
# Channels: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET
# Billing (if live): STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_STARTER/PRO/SCALE
# WhatsApp/Meta (when approved): META_SYSTEM_USER_TOKEN, META_SYSTEM_USER_ID, META_APP_ID,
#   META_APP_SECRET, META_WEBHOOK_VERIFY_TOKEN, META_CAPI_ACCESS_TOKEN
# Meta Ads connect: FACEBOOK_APP_ID, FACEBOOK_APP_SECRET, FACEBOOK_REDIRECT_URI
# (leave DEV_BYPASS_AUTH UNSET)
```
