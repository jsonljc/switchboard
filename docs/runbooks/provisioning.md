# Provisioning runbook (production hosting)

Step-by-step setup of Switchboard's production hosting. Companion to [`production-urls.md`](./production-urls.md) (fill that table in as you go), [`deploy-troubleshooting.md`](./deploy-troubleshooting.md), and the design in `docs/superpowers/specs/archive/2026-05-15-deployment-hosting-design.md`.

## Topology

| Component                                 | Host                                       | Source                                              |
| ----------------------------------------- | ------------------------------------------ | --------------------------------------------------- |
| `apps/dashboard` (Next.js UI)             | **Vercel**                                 | one Vercel project, Root Directory `apps/dashboard` |
| `apps/api` (Fastify REST, port 3000)      | **Render** Web Service `switchboard-api`   | `render.yaml` + `Dockerfile.api`                    |
| `apps/chat` (Fastify webhooks, port 3001) | **Render** Web Service `switchboard-chat`  | `render.yaml` + `Dockerfile.chat`                   |
| Postgres 16                               | **Render** Postgres `switchboard-postgres` | `render.yaml`                                       |
| Redis                                     | **Render** Key Value `switchboard-redis`   | `render.yaml`                                       |
| Async jobs / crons (creative pipeline)    | **Inngest Cloud**                          | app auto-registers functions                        |
| Creative asset storage                    | **Cloudflare R2** (or any S3-compatible)   | env-configured                                      |

Rule of thumb: the Next.js frontend goes on Vercel; the persistent Fastify servers plus data go on Render in one region (`oregon`) so they share a private network. `apps/api` cannot run on Vercel (it is a long-lived server, not serverless).

## 0. Prerequisites

- Accounts: **Render**, **Vercel**, **Inngest Cloud**, **Cloudflare** (R2) or other S3 host.
- A **password manager / secret vault** as the master copy of every secret. Record each secret's vault path in `production-urls.md`. Render and Vercel hold _copies_.
- A **domain** you control, for: the dashboard (e.g. `app.example.com`), the chat webhook host (e.g. `chat.example.com`), and the API (e.g. `api.example.com`).
- Third-party credentials ready: Anthropic, Voyage, Stripe (secret + webhook signing), Meta (system-user token, app secret, webhook verify token, pixel id), WhatsApp Graph token, Telegram bot token + webhook secret, Slack bot token + signing secret, Resend API key.
- Generate the shared secrets once (same value reused across services where noted):
  ```bash
  openssl rand -hex 32   # CREDENTIALS_ENCRYPTION_KEY  (MUST be identical on api + chat)
  openssl rand -hex 32   # SESSION_TOKEN_SECRET
  openssl rand -hex 32   # INTERNAL_API_SECRET         (shared api <-> chat)
  openssl rand -hex 32   # INTERNAL_SETUP_SECRET
  openssl rand -base64 32 # NEXTAUTH_SECRET            (dashboard)
  openssl rand -hex 32   # META_WEBHOOK_VERIFY_TOKEN / TELEGRAM_WEBHOOK_SECRET
  ```

## 1. Render: create the Blueprint (api + chat + Postgres + Redis)

`render.yaml` is infrastructure-as-code; Render provisions all four services from it.

1. Render Dashboard → **New → Blueprint**.
2. Connect the GitHub repo, select branch `main`. Render reads `render.yaml` and shows the plan: `switchboard-api`, `switchboard-chat` (web, Docker), `switchboard-postgres` (PG 16), `switchboard-redis` (Key Value). All in `oregon`, `starter` plan.
3. Click **Apply**. `DATABASE_URL` and `REDIS_URL` auto-wire from the DB/KeyValue services; `SWITCHBOARD_API_URL` on chat auto-points at `http://switchboard-api:3000` over the private network.
4. The first deploy will **wait** on the `sync: false` env vars (step 2). That is expected.

`switchboard-api` runs `prisma migrate deploy` as its `preDeployCommand`, so migrations apply automatically before each release. No manual migration step.

## 2. Render: fill the `sync: false` secrets

In Render, open each service → **Environment** and set the values declared in `render.yaml`. Enter from your vault.

**`switchboard-api`:**
`CREDENTIALS_ENCRYPTION_KEY`, `INTERNAL_API_SECRET`, `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `META_SYSTEM_USER_TOKEN`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_GRAPH_TOKEN`, `META_PIXEL_ID`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `SESSION_TOKEN_SECRET`, `INTERNAL_SETUP_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `CHAT_PUBLIC_URL`, `CHAT_SERVER_URL`, `CREATIVE_PIPELINE_ALLOWED_HOSTS`, `CREATIVE_ASSET_*` (bucket, endpoint, region, access key id, secret, public base url), `CORS_ORIGIN`, `SENTRY_DSN_SERVER`.

**`switchboard-chat`:**
`CREDENTIALS_ENCRYPTION_KEY` (**same value as api**), `INTERNAL_API_SECRET` (**same as api**), `CHAT_SERVER_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `VOYAGE_API_KEY`, `ANTHROPIC_API_KEY`, `SENTRY_DSN_SERVER`.

Critical cross-service values:

- `CREDENTIALS_ENCRYPTION_KEY` **must be byte-identical** on api and chat (and never change after data is encrypted, or stored credentials become unreadable).
- `CORS_ORIGIN` (api) **must include the dashboard's Vercel URL** (e.g. `https://app.example.com`) or every dashboard to API call is rejected (prod fails closed on origin).

After saving, trigger a deploy of each service. Confirm `/health` is green on both.

## 3. Cloudflare R2 (creative asset storage)

The creative pipeline fails loud (`CREATIVE_ASSET_NOT_DURABLE`) without durable storage.

1. Create an R2 bucket; make it public-read at a stable base URL (or front with a CDN domain).
2. Create an R2 API token (access key id + secret).
3. Set on `switchboard-api`: `CREATIVE_ASSET_BUCKET`, `CREATIVE_ASSET_S3_ENDPOINT` (R2 endpoint), `CREATIVE_ASSET_REGION` (`auto` for R2), `CREATIVE_ASSET_ACCESS_KEY_ID`, `CREATIVE_ASSET_SECRET_ACCESS_KEY`, `CREATIVE_ASSET_PUBLIC_BASE_URL`.
4. Set `CREATIVE_PIPELINE_ALLOWED_HOSTS` to the comma-separated host regexes the pipeline may fetch from (SSRF allow-list).

## 4. Inngest Cloud (async jobs)

1. Create an Inngest Cloud app; get the **Event Key** and **Signing Key**.
2. Set `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` on `switchboard-api`.
3. Register the serve endpoint with Inngest: `https://api.example.com/api/inngest` (the API exposes the Inngest handler). Inngest then drives crons and background functions against the deployed API.

## 5. Vercel (dashboard only)

1. Vercel → **New Project** → import the same repo.
2. **Root Directory = `apps/dashboard`.** Framework Preset = **Next.js** (auto-detected). Leave Build/Install commands at Vercel defaults; the turbo `^build` chain runs `prisma generate` for `@switchboard/db` so the Prisma client is generated. (If you ever override the build command, use `turbo build --filter @switchboard/dashboard` so the dependency chain still runs.)
3. Add a custom domain (e.g. `app.example.com`).
4. **Environment variables** (Production scope). `NEXT_PUBLIC_*` are inlined at build time, so set them before the first build and redeploy after any change:
   - `NEXT_PUBLIC_API_URL` = `https://api.example.com` (the Render API public URL) — **required**, defaults to localhost otherwise
   - `NEXT_PUBLIC_APP_URL` = `https://app.example.com`
   - `NEXT_PUBLIC_DEPLOY_ENV`, `NEXT_PUBLIC_LAUNCH_MODE`
   - `NEXT_PUBLIC_META_APP_ID`, `NEXT_PUBLIC_META_CONFIG_ID`
   - `NEXT_PUBLIC_STRIPE_ENABLED`, `NEXT_PUBLIC_STRIPE_PRICE_{STARTER,PRO,SCALE}`
   - `NEXT_PUBLIC_{CONTACTS,AUTOMATIONS,ACTIVITY,REPORTS,APPROVALS}_LIVE` (feature flags; set `true` to enable)
   - `NEXT_PUBLIC_{SMTP,GOOGLE_AUTH}_CONFIGURED`, `NEXT_PUBLIC_SENTRY_DSN`
   - Server runtime (not build-inlined): `NEXTAUTH_SECRET`, `NEXTAUTH_URL` (= app URL), `SWITCHBOARD_API_URL` (= `https://api.example.com`), `SWITCHBOARD_API_KEY`, `CREDENTIALS_ENCRYPTION_KEY` (**same value as the API**), `DATABASE_URL` (the Render Postgres external connection string).
5. Deploy. Then go back to the Render `switchboard-api` `CORS_ORIGIN` and make sure it lists `https://app.example.com`.

## 6. DNS and custom domains

Point your DNS at the hosts:

- `app.example.com` → Vercel (dashboard)
- `api.example.com` → Render `switchboard-api`
- `chat.example.com` → Render `switchboard-chat` (needed as the stable webhook host)

Set `CHAT_PUBLIC_URL` / `CHAT_SERVER_URL` to `https://chat.example.com`.

## 7. Register webhooks (after chat has a public domain)

| Provider                    | Endpoint                                                | Secret to match                                                                     |
| --------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| WhatsApp / Instagram (Meta) | `https://chat.example.com/webhook/managed/<webhookId>`  | `META_WEBHOOK_VERIFY_TOKEN` + `META_APP_SECRET` (api), `WHATSAPP_APP_SECRET` (chat) |
| Telegram                    | `https://chat.example.com/webhook/telegram`             | `TELEGRAM_WEBHOOK_SECRET` (register via `pnpm cli:register-webhook`)                |
| Slack                       | `https://chat.example.com/webhook/managed/<webhookId>`  | `SLACK_SIGNING_SECRET`                                                              |
| Stripe                      | `https://api.example.com/api/webhooks/payments/webhook` | `STRIPE_WEBHOOK_SECRET`                                                             |

## 8. Remove the stray `switchboard-api` Vercel project

If a Vercel project named `switchboard-api` exists, delete it (Vercel → that project → Settings → Advanced → Delete Project). `apps/api` runs on Render; a Vercel project for it can only ever fail. Vercel should have exactly one project: the dashboard.

## 9. Smoke test

1. `https://api.example.com/health` and `https://chat.example.com/health` return 200.
2. `https://api.example.com/api/health/deep` reports DB + Redis reachable.
3. Load the dashboard, sign in, confirm it loads data (proves dashboard -> API -> DB and that `CORS_ORIGIN` + `NEXT_PUBLIC_API_URL` are correct).
4. Send a test message to a connected channel; confirm it reaches chat and a reply path works.
5. Inngest Cloud dashboard shows the app's functions registered.

## 10. Record everything

Fill in `production-urls.md`: service URLs, webhook URLs, monitoring dashboards (Sentry, UptimeRobot on `/api/health/deep` for api + chat, Render, Vercel, Inngest), the vault-path map for every secret, and rollback URLs.

## Ongoing

- **Deploys are automatic** on push to `main`: Render rebuilds api/chat (filtered by `buildFilter` paths), Vercel rebuilds the dashboard.
- **Rollback:** Render → service → Deploys → roll back to a prior deploy; Vercel → Deployments → promote a prior deployment. Env-flag features roll back by flipping the flag and redeploying.
- **Secret rotation:** see [`secret-rotation.md`](./secret-rotation.md). Rotate the vault copy first, then update Render/Vercel.
