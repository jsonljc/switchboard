# Switchboard — First Customer Deployment Checklist

## Pre-Deployment

### 1. Generate secrets

```bash
# Generate all required secrets (run once, save securely)
echo "NEXTAUTH_SECRET=$(openssl rand -base64 32)"
echo "CREDENTIALS_ENCRYPTION_KEY=$(openssl rand -base64 32)"
echo "INTERNAL_API_SECRET=$(openssl rand -base64 32)"
echo "SESSION_TOKEN_SECRET=$(openssl rand -base64 32)"
echo "SWITCHBOARD_API_KEY=$(openssl rand -hex 24)"
echo "BOOKING_WEBHOOK_SECRET=$(openssl rand -hex 16)"
```

### 2. Create `.env` file

Copy `.env.example` to `.env` and fill in:

| Variable                     | Required | Where to get it                                                                              |
| ---------------------------- | -------- | -------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`          | Yes      | [console.anthropic.com](https://console.anthropic.com)                                       |
| `VOYAGE_API_KEY`             | Yes\*    | [dash.voyageai.com](https://dash.voyageai.com) — without this, knowledge retrieval is random |
| `NEXTAUTH_SECRET`            | Yes      | Generated above                                                                              |
| `NEXTAUTH_URL`               | Yes      | Your dashboard URL (e.g. `https://dashboard.yourdomain.com`)                                 |
| `CREDENTIALS_ENCRYPTION_KEY` | Yes      | Generated above — used by API server and dashboard for API key encryption                    |
| `INTERNAL_API_SECRET`        | Yes      | Generated above — shared between API, chat, dashboard                                        |
| `SWITCHBOARD_API_KEY`        | Yes      | Generated above — chat + dashboard use this to call API                                      |
| `SESSION_TOKEN_SECRET`       | Yes      | Generated above                                                                              |
| `CORS_ORIGIN`                | Yes      | Your dashboard URL                                                                           |
| `CHAT_PUBLIC_URL`            | Yes      | Public URL for chat webhooks (e.g. `https://chat.yourdomain.com`)                            |

**Channel — pick at least one:**

| Variable                                      | For                           |
| --------------------------------------------- | ----------------------------- |
| `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp Business API         |
| `TELEGRAM_BOT_TOKEN`                          | Telegram bot (via @BotFather) |

**Billing (required for paid features):**

| Variable                | For                              |
| ----------------------- | -------------------------------- |
| `STRIPE_SECRET_KEY`     | Stripe API secret key            |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret    |
| `STRIPE_PRICE_STARTER`  | Stripe Price ID for Starter plan |
| `STRIPE_PRICE_PRO`      | Stripe Price ID for Pro plan     |
| `STRIPE_PRICE_SCALE`    | Stripe Price ID for Scale plan   |

**Infrastructure:**

| Variable       | For                            |
| -------------- | ------------------------------ |
| `SENTRY_DSN`   | Sentry error tracking DSN      |
| `NGINX_DOMAIN` | Domain name for TLS cert paths |

**Optional (enable when needed):**

| Variable                                        | For                                                     |
| ----------------------------------------------- | ------------------------------------------------------- |
| `META_ADS_ACCESS_TOKEN` + `META_ADS_ACCOUNT_ID` | Ad optimizer agent                                      |
| `EMAIL_SERVER_*`                                | Magic link login (credentials login works without SMTP) |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                   | Distributed tracing (Jaeger)                            |

### 3. TLS setup

1. Set `NGINX_DOMAIN` in your environment
2. Run `docker compose run certbot certonly --webroot -w /var/www/certbot -d $NGINX_DOMAIN`
3. Process nginx.conf: `envsubst '${NGINX_DOMAIN}' < nginx/nginx.conf > /etc/nginx/nginx.conf`
4. Reload nginx: `nginx -s reload`

### 4. Stripe webhook registration

1. Go to [Stripe Dashboard > Webhooks](https://dashboard.stripe.com/webhooks)
2. Add endpoint: `https://$NGINX_DOMAIN/api/billing/webhook`
3. Subscribe to events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`, `customer.subscription.trial_will_end`
4. Copy the signing secret to `STRIPE_WEBHOOK_SECRET`

### 5. Configure skin + profile

```bash
# In .env — pick the customer's vertical
SKIN_ID=clinic        # or: gym, commerce, generic
PROFILE_ID=clinic-demo  # or create a custom profile in profiles/
LEAD_BOT_MODE=true
```

For a custom profile, create `profiles/<customer-name>/config.json` with business-specific info (services, pricing, hours, tone).

---

## Deploy

### Option A: Docker Compose (simplest)

```bash
# Build and start everything
docker compose up -d --build

# Verify all services are healthy
docker compose ps

# Check logs
docker compose logs -f api chat dashboard
```

Services start in order: postgres → redis → db-migrate → api → chat + dashboard.

### Option B: Cloud hosting (VPS / DigitalOcean / Railway / Fly.io)

1. Push the repo to your hosting provider
2. Set all env vars from step 2
3. Ensure PostgreSQL 16+ with pgvector extension is available
4. Ensure Redis 7+ is available
5. Run migrations: `npx prisma migrate deploy --schema packages/db/prisma/schema.prisma`
6. Start services: `node apps/api/dist/main.js`, `node apps/chat/dist/main.js`, `next start` for dashboard

---

## Post-Deploy Verification

### 4. Health checks

```bash
# API
curl https://your-api-url/health
curl https://your-api-url/api/health/deep  # checks DB + Redis + cartridges

# Dashboard
curl https://your-dashboard-url

# Chat
curl https://your-chat-url/health
```

### 5. Set up WhatsApp webhook (if using WhatsApp)

1. Go to [Meta Developer Console](https://developers.facebook.com)
2. Set webhook URL: `https://your-chat-url/webhook/managed/<org-id>`
3. Subscribe to `messages` webhook field
4. Verify the webhook with your `TELEGRAM_WEBHOOK_SECRET` or WhatsApp verify token

### 6. Set up Telegram webhook (if using Telegram)

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://your-chat-url/webhook/managed/<org-id>"
```

### 7. Create first dashboard user

1. Navigate to `https://your-dashboard-url/login`
2. Register with email + password (credentials login works without SMTP)
3. Complete the 6-step onboarding wizard:
   - Business basics (name, vertical, services, pricing)
   - Agent selection (which agents to activate)
   - Agent tone/style
   - Knowledge base + behavioral rules (upload `.txt`/`.md` docs)
   - Channel setup (connect WhatsApp/Telegram)
   - Review & launch

### 8. Test the flow

```bash
# Send a test message via the channel you configured
# Or use the dashboard's built-in Test Chat widget

# Verify in dashboard:
# - /decide — approval queue should show "Nothing waiting on you"
# - /settings/knowledge — uploaded docs should appear with chunk counts
# - Conversations should appear after test messages
```

---

## Ongoing Operations

### Monitoring

- **Health**: `/api/health/deep` returns DB, Redis, cartridge, queue status
- **Logs**: `docker compose logs -f <service>`
- **Tracing**: Enable Jaeger with `docker compose --profile tracing up -d`
- **Queue depth**: BullMQ dashboard or `/api/health/deep` reports queue sizes

### Backups

```bash
# Database backup
docker compose exec postgres pg_dump -U switchboard switchboard > backup-$(date +%Y%m%d).sql

# Restore
cat backup-YYYYMMDD.sql | docker compose exec -T postgres psql -U switchboard switchboard
```

### Updates

```bash
git pull origin main
docker compose up -d --build
# Migrations run automatically via db-migrate service
```

### Key rotation

```bash
# 1. Generate new secret
# 2. Update .env
# 3. Restart affected service
docker compose restart api    # for API_KEYS, INTERNAL_API_SECRET
docker compose restart chat   # for CREDENTIALS_ENCRYPTION_KEY, channel tokens
docker compose restart dashboard  # for NEXTAUTH_SECRET, CREDENTIALS_ENCRYPTION_KEY
```

## Dashboard Release Gate

Before launch, make sure the dashboard production env is present:

- `NEXTAUTH_SECRET`
- `SWITCHBOARD_API_URL`

Then run:

```bash
pnpm dashboard:preflight
pnpm --filter @switchboard/dashboard test
pnpm --filter @switchboard/dashboard build
```

Do not launch if any of the three commands fail.

## Onboarding Funnel Smoke Test

1. Submit a waitlist request and confirm persisted success or an explicit failure
2. Start onboarding with a website URL and refresh on step 2
3. Start onboarding without a website and confirm the manual path still works
4. Open `/settings` on a mobile viewport and confirm the settings menu renders
5. Open `/settings/knowledge` and confirm a loading state is visible
6. Trigger a website scan failure and confirm retry plus manual fallback are visible

## Dashboard Presentation Sweep

1. Share the homepage URL in Slack or iMessage and confirm the `og-image.png` preview renders
2. Open the site on macOS and iOS and confirm the favicon and Apple touch icon appear
3. Recheck the pricing page and confirm no placeholder launch copy is visible
4. Open the production dashboard and confirm no dev-only controls appear

---

## Architecture (for reference)

```
Internet
  |
  +-- WhatsApp/Telegram --> Chat (port 3001) --> API (port 3000) --> PostgreSQL + Redis
  |                                                |
  +-- Browser -----------> Dashboard (port 3002) --+
```

- **API** (port 3000): Orchestrator, agents, workflows, approvals, knowledge
- **Chat** (port 3001): Webhook receiver, channel adapters, delegates to API EventLoop
- **Dashboard** (port 3002): Next.js admin UI, onboarding wizard, operator chat
- **PostgreSQL**: All data + pgvector for knowledge embeddings
- **Redis**: Rate limiting, idempotency, BullMQ job queues
