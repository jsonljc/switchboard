# Production URLs and Hosting Map

> **Status:** Template. Operator fills in at provisioning time per `docs/superpowers/specs/2026-05-15-deployment-hosting-design.md` §10 step 10.

## Service URLs

| Service   | URL             | Host                        | Plan        | Notes                                                                                   |
| --------- | --------------- | --------------------------- | ----------- | --------------------------------------------------------------------------------------- |
| Dashboard | `https://<TBD>` | Vercel                      | <Hobby/Pro> | Next.js + NextAuth. PR previews on.                                                     |
| API       | `https://<TBD>` | Render Web Service (public) | Starter     | Fastify REST. `SWITCHBOARD_API_URL` on chat + dashboard points here.                    |
| Chat      | `https://<TBD>` | Render Web Service (public) | Starter     | Fastify webhook server. Custom domain (`chat.<your-domain>`) recommended for Meta.      |
| Postgres  | (internal)      | Render Postgres             | Starter     | Snapshots: daily, <RETENTION_DAYS> retention. Validated at provisioning.                |
| Redis     | (internal)      | Render Key Value            | Starter     | Cache + rate-limit. Lose-able. (Render's managed Redis is the `keyvalue` service type.) |

## Render region

- **Chosen region:** `oregon` (pinned in `render.yaml`, 2026-05-15)
- **Rationale:** Defensible US default — Render's most established region, full service-type parity (Web Service, Postgres, KeyValue), acceptable Meta-webhook latency for pilot scale. Re-evaluate per spec §3 if pilot users cluster outside US West.

## Webhook callback URLs (registered with providers)

| Provider         | Endpoint                                            | Registered at                          | Verify token / signing secret reference         |
| ---------------- | --------------------------------------------------- | -------------------------------------- | ----------------------------------------------- |
| WhatsApp (Meta)  | `https://<chat-domain>/webhook/managed/<webhookId>` | Meta Business Manager                  | `WHATSAPP_VERIFY_TOKEN` + `WHATSAPP_APP_SECRET` |
| Instagram (Meta) | `https://<chat-domain>/webhook/managed/<webhookId>` | Meta Business Manager                  | Same as WhatsApp app                            |
| Telegram         | `https://<chat-domain>/webhook/telegram`            | `pnpm cli:register-webhook`            | `TELEGRAM_WEBHOOK_SECRET`                       |
| Slack            | `https://<chat-domain>/webhook/managed/<webhookId>` | Slack app config (Event Subscriptions) | `SLACK_SIGNING_SECRET`                          |

## Monitoring dashboards

| Surface                               | URL     |
| ------------------------------------- | ------- |
| Sentry (server)                       | `<TBD>` |
| Sentry (client)                       | `<TBD>` |
| UptimeRobot (api `/api/health/deep`)  | `<TBD>` |
| UptimeRobot (chat `/api/health/deep`) | `<TBD>` |
| Render dashboard                      | `<TBD>` |
| Vercel dashboard                      | `<TBD>` |
| Inngest Cloud                         | `<TBD>` |

## Vault entries map

> The master copy of every secret lives in the password manager. The host-UI value is a copy. This table records the path/title in the vault for each Render env-var key, so rotations have a single source of truth to update first.

| Render env-var key                   | Vault item path/title |
| ------------------------------------ | --------------------- |
| `CREDENTIALS_ENCRYPTION_KEY`         | `<TBD>`               |
| `INTERNAL_API_SECRET`                | `<TBD>`               |
| `ANTHROPIC_API_KEY`                  | `<TBD>`               |
| `VOYAGE_API_KEY`                     | `<TBD>`               |
| `META_ADS_ACCESS_TOKEN`              | `<TBD>`               |
| `META_PIXEL_ID`                      | `<TBD>`               |
| `WHATSAPP_TOKEN`                     | `<TBD>`               |
| `WHATSAPP_APP_SECRET`                | `<TBD>`               |
| `WHATSAPP_VERIFY_TOKEN`              | `<TBD>`               |
| `TELEGRAM_BOT_TOKEN`                 | `<TBD>`               |
| `TELEGRAM_WEBHOOK_SECRET`            | `<TBD>`               |
| `SLACK_BOT_TOKEN`                    | `<TBD>`               |
| `SLACK_SIGNING_SECRET`               | `<TBD>`               |
| `STRIPE_SECRET_KEY`                  | `<TBD>`               |
| `STRIPE_WEBHOOK_SECRET`              | `<TBD>`               |
| `INNGEST_EVENT_KEY`                  | `<TBD>`               |
| `INNGEST_SIGNING_KEY`                | `<TBD>`               |
| `SENTRY_DSN_SERVER`                  | `<TBD>`               |
| `NEXT_PUBLIC_SENTRY_DSN` (on Vercel) | `<TBD>`               |
| `NEXTAUTH_SECRET` (on Vercel)        | `<TBD>`               |

## Rollback URLs

| Target                      | URL     |
| --------------------------- | ------- |
| Render rollback (api)       | `<TBD>` |
| Render rollback (chat)      | `<TBD>` |
| Vercel rollback (dashboard) | `<TBD>` |

## Postgres backup management

- **Snapshot listing:** Render dashboard → switchboard-postgres → Backups
- **Restore drill cadence:** quarterly, before public launch, after major schema migration (per spec §8)
- **Last drill:** `<TBD>`
- **Next drill due:** `<TBD>`
