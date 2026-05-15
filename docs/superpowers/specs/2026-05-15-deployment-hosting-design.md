# Deployment & Hosting — Pilot Launch Design

**Date:** 2026-05-15
**Status:** Design (pending approval)
**Author:** Jason
**Context:** /contacts pipeline shipped 2026-05-15 exposed that Switchboard has no documented production deployment story beyond Vercel for the dashboard. This spec closes that gap for pilot launch (10–50 paying customers, solo operator, full self-serve product).

---

## 1. Goals and non-goals

### Goals
- Land a documented production deployment for `apps/dashboard`, `apps/api`, `apps/chat`, `apps/mcp-server` with managed Postgres, Redis, async-job orchestration, and error monitoring.
- Optimize for **solo operator attention** as the scarce resource, not infrastructure cost.
- Stable webhook URLs for Meta App Review (WhatsApp), Telegram, and Slack.
- Push-to-deploy from `main` with single-click rollback per service.
- Total monthly infra cost target **< $100/mo** for the pilot.

### Non-goals
- Multi-region deployment.
- Autoscaling beyond Render's defaults.
- Self-hosted Kubernetes, mTLS service mesh, or distributed tracing.
- Preview environments for backend services (`apps/dashboard` PR previews remain via Vercel).
- Production-grade observability (PagerDuty rotations, SLO dashboards, custom metrics pipelines).
- Designing the architecture for post-pilot scale. See §8 *Exit conditions* for re-evaluation triggers.

---

## 2. Topology

```
                        ┌────────────────────────┐
   End users  ──HTTPS──▶│  Vercel (CDN + edge)   │
                        │  apps/dashboard        │
                        │  Next.js 14, NextAuth  │
                        └────────────┬───────────┘
                                     │  HTTPS (auth-gated REST)
                                     ▼
   Meta /                ┌────────────────────────┐         ┌──────────────────┐
   Telegram / ─webhook──▶│  Render — chat (public)│         │ Render — mcp     │
   Slack                 │  apps/chat             │  ◀──────│ (private)        │
                         │  Fastify webhook       │ private │ apps/mcp-server  │
                         └────────────┬───────────┘ network └──────────────────┘
                                      │  HTTP (private)             ▲
                                      ▼                             │ private
                         ┌────────────────────────┐                 │
                         │  Render — api (public) │ ◀───────────────┘
                         │  apps/api              │
                         │  Fastify REST          │
                         └────────────┬───────────┘
                                      │
                       ┌──────────────┴──────────────┐
                       ▼                             ▼
              ┌──────────────────┐         ┌──────────────────┐
              │ Render Postgres  │         │ Render Redis     │
              │ (managed)        │         │ (managed)        │
              └──────────────────┘         └──────────────────┘

   Async jobs ─────────▶┌────────────────────────┐
                        │ Inngest Cloud          │  Orchestrates events.
                        │ (free tier at pilot)   │  Handlers execute inside
                        └────────────────────────┘  apps/api (no separate worker).

   Errors ─────────────▶┌────────────────────────┐
                        │ Sentry                 │  Server DSN: Render only.
                        │ (free tier)            │  Client DSN: Vercel only.
                        └────────────────────────┘
```

**Why this shape:**
- `apps/dashboard` stays on Vercel — Next.js is Vercel's primary target, edge CDN + PR previews + image optimization are real wins, no reason to move it.
- `apps/api` and `apps/chat` are public Render Web Services because they must be reachable: `api` is called over HTTPS by the Vercel-hosted dashboard, `chat` receives webhooks from Meta/Telegram/Slack. Both remain auth-gated and do not expose internal tool surfaces.
- `apps/mcp-server` is a private Render service. It is only reachable by `api` and `chat` over Render's private network when those services need tool execution. No external traffic.
- Postgres and Redis are managed Render services for zero-ops backups and connection pooling.
- Inngest Cloud orchestrates async jobs; **execution handlers live in `apps/api`** unless and until a separate worker service is required by scale.
- Sentry uses two distinct DSNs (`SENTRY_DSN_SERVER` on Render, `NEXT_PUBLIC_SENTRY_DSN` on Vercel) so the client one is public-safe by design and the server one stays Render-only.

## 3. Service inventory and sizing

**All Render plan tiers below are current targets / estimates. Validate Render plan limits and pricing on the Render dashboard before provisioning.** Plan structures change.

| Service | Type | Current target plan | Notes |
|---|---|---|---|
| `dashboard` | Vercel | Hobby or Pro (~$0–20/mo) | Next.js, NextAuth, dashboard UI. PR previews remain on. |
| `api` | Render Web Service (public) | Starter ~$7/mo | Fastify REST. Public so the Vercel dashboard can reach it over HTTPS. Auth-gated. Sole migration runner. |
| `chat` | Render Web Service (public) | Starter ~$7/mo | Fastify webhook server for Meta/Telegram/Slack. Stable `*.onrender.com` URL bound to a custom domain pre-Meta-review. |
| `mcp` | Render Private Service | Starter ~$7/mo | MCP tool surface (Dockerfile target `mcp-server`). Reachable from `api`/`chat` over Render's private network on its internal hostname; the port is set by `PORT` at provisioning, no public DNS. |
| Postgres | Render Postgres | Starter ~$7/mo | Single durable store. Auto daily snapshots; **validate retention period before provisioning.** |
| Redis | Render Redis | Starter ~$10/mo | Cache + rate-limit counters + session store. Lose-able by design. |

**Pilot estimate: ~$38–58/mo backend + $0–20/mo Vercel. Within the <$100/mo ceiling.**

### Region

**Pick the Render region closest to primary pilot users and webhook traffic**, while confirming availability for all required services (Web Service, Private Service, Postgres, Redis). Document the chosen region in `docs/runbooks/production-urls.md` along with the rationale.

Webhook latency from Meta's nearest edge to the chosen region is the dominant constraint — if Meta retries webhooks aggressively, distant regions degrade message reliability before they degrade dashboard performance.

If Render's available regions don't include a sufficiently close option for the primary user geography, note that as a candidate exit condition (§8) and lean toward Fly.io's broader region coverage at migration time.

## 4. Environment variable discipline

**Single source of truth:** a password manager (1Password / Bitwarden / equivalent), one vault per environment scope (Production, optional Staging). Host UIs hold copies. No Doppler/Infisical layer at pilot — too few secrets to justify another vendor.

### Ownership matrix

| Variable | Vercel | Render | GitHub Actions | Master vault |
|---|---|---|---|---|
| `NEXT_PUBLIC_*` flags (CONTACTS_LIVE, REPORTS_LIVE, …) | ✅ per-environment, **default off for Preview unless explicitly enabled** | — | — | ✅ |
| `NEXTAUTH_SECRET`, `NEXTAUTH_URL` | ✅ | — | — | ✅ |
| `NEXT_PUBLIC_API_BASE_URL` (→ Render `api` public URL) | ✅ | — | — | ✅ |
| `NEXT_PUBLIC_SENTRY_DSN` (client-safe) | ✅ | — | — | ✅ |
| `DATABASE_URL`, `REDIS_URL` | ❌ never | ✅ auto-injected by Render's managed DB | — | — |
| `CREDENTIALS_ENCRYPTION_KEY` | ❌ | ✅ | — | ✅ |
| `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY` | ❌ | ✅ | — | ✅ |
| `TELEGRAM_*`, `WHATSAPP_*`, `META_ADS_*` | ❌ | ✅ | — | ✅ |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | ❌ | ✅ | — | ✅ |
| `INTERNAL_API_SECRET` (api ↔ chat ↔ mcp shared) | ❌ | ✅ same value across all 3 services | — | ✅ |
| `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | ❌ | ✅ | — | ✅ |
| `SENTRY_DSN_SERVER` (Render-only) | ❌ | ✅ | — | ✅ |
| Render / Vercel deploy hook URLs | — | — | ✅ secrets | ✅ |

### Discipline rules

1. **`.env.example` documents shape, not values.** A PR that flips an `.env.example` flag must include a note in the PR description explaining which host UI must mirror the change for it to take effect. Repo files are documentation; host stores are runtime truth.
2. **`NEXT_PUBLIC_*` is reserved for public-safe values.** Anything sensitive cannot wear this prefix. Worth a lint rule later.
3. **One owner per secret per environment.** Master record in the vault; copies to host UIs. Rotation updates the vault first, then propagates to hosts.
4. **Provider-issued tokens have a documented rotation procedure.** Each of Anthropic, Meta (WhatsApp + Ads), Telegram, Stripe gets a 5-line entry in `docs/runbooks/secret-rotation.md` listing the dashboard URL, rotation steps, and Render env keys to update.
5. **`INTERNAL_API_SECRET` is the only service-to-service auth at pilot** — same shared value across `api`/`chat`/`mcp`. **Acknowledged limitation: this is a simple pilot control, not long-term service identity.** **Exit condition:** replace with per-service credentials or mTLS when internal service count grows beyond 3, external contractors touch the services, or privilege separation becomes material.
6. **GitHub Actions receives no runtime app secrets.** Deploy-hook URLs are allowed because they are deployment-control, not application data. App secrets (Anthropic, Meta, Stripe) never appear in Actions to keep Actions from becoming a third secret runtime.

## 5. Deployment flow

### Render topology in repo: `render.yaml`

The Render topology lives in a committed `render.yaml` at the repo root — Infrastructure-as-Code for the backend stack. It declares the `api`, `chat`, and `mcp` services, the managed Postgres and Redis instances, the Dockerfile target for each service, the `preDeployCommand` on `api`, and the `healthCheckPath` per service (`/healthz`). Env-var **values** stay in the Render UI; `render.yaml` only declares which variables each service expects, never their secret values. Region is set in `render.yaml` to keep provisioning reproducible.

Vercel has no equivalent committed config in this spec — the Vercel project remains configured in the Vercel dashboard (consistent with [[deploy-host-vercel]]).

### Trigger model

Push to `main` → Vercel and Render auto-deploy in parallel.

| Host | Trigger | Preview environments |
|---|---|---|
| Vercel (`dashboard`) | Auto on `main` push; PR previews on by default | ✅ PR previews — `NEXT_PUBLIC_*` flags default off in Preview scope unless explicitly enabled |
| Render (`api`, `chat`, `mcp`) | Auto-Deploy enabled on connected GitHub repo, branch `main` | ❌ Skipped at pilot — use local `docker-compose.prod.yml` for pre-merge integration testing. Add a `staging` blueprint later only if pilot reveals it is needed. |

### Build sequence on Render

1. Render detects push to `main`.
2. Pulls repo; builds the relevant Dockerfile target (`api` / `chat` / `mcp`).
3. **Pre-deploy command runs only on `api`:** `pnpm --filter @switchboard/db migrate deploy`.
4. **Invariant: `api` is the sole migration runner. `chat` and `mcp` MUST NOT run `prisma migrate deploy`** — this prevents race conditions when Render deploys services in parallel. Enforced by leaving `chat` and `mcp` with no pre-deploy command.
5. Health-check (`GET /healthz`) gates container promotion.
6. Failure → previous container retained, alert fires (§7).

### Migration discipline

- Schema changes ship in the same commit as code (per `CLAUDE.md`).
- Migrations are **expand-contract / backwards-compatible across one deploy** by default, so the in-flight old container can survive the canary window.
- **Non-backwards-compatible migrations are prohibited during pilot** unless split into expand → backfill → contract phases across multiple deploys. If a single-step destructive migration is unavoidable (e.g., a compliance-driven column drop), it requires: a written restore plan, a tested backup, a maintenance window with users notified, and explicit operator approval recorded in the PR description. "Revert code, leave schema" is the default rollback shape; rollback-by-schema is not encouraged.

### API contract discipline

Vercel and Render builds aren't coordinated. There's a brief window during deploy where one is updated and the other isn't. **API request/response shapes must therefore be backwards-compatible across one deploy** — same discipline as schemas. Breaking changes require the same expand-contract phasing.

## 6. Rollback flow

Three rollback shapes by failure mode:

| Failure | Action | Target time |
|---|---|---|
| **Bad code** (deployed bug) | Render dashboard → service → "Rollback to previous deploy" (retains ~last 30 deploys). Vercel: Deployments → previous → "Promote to Production". | < 5 min |
| **Bad env-var flip** (e.g., a feature flag reveals broken UX) | Flip var back on the host. Vercel `NEXT_PUBLIC_*` requires a rebuild (inlined at build); Render vars apply on container restart. | < 5 min Render, < 10 min Vercel |
| **Bad migration** (schema breakage) | Backwards-compat discipline = "revert code, leave schema." Non-backwards-compat with a tested restore plan only (§5). Render's automatic Postgres snapshots are the last resort, not the first. | < 30 min |

### Feature-flag-shaped kill switches

Anything user-visible that we're nervous about ships behind a flag so rollback is one toggle plus one redeploy, not a code revert:

- **UI visibility uses `NEXT_PUBLIC_*` flags** (read by Next.js at build time, inlined into the client bundle).
- **Backend behavior uses server-only `*_ENABLED` flags on Render** (read at runtime, no rebuild required, never exposed to the client).

The `/contacts` PR-C3 flip is the canonical UI-flag example. Backend examples include `OUTCOME_PATTERNS_ENABLED` for the agent infra outcome injector.

## 7. Health checks, observability, and alerting

### Health checks — liveness vs readiness

| Service | `/healthz` (liveness) | `/readyz` (readiness) |
|---|---|---|
| `api` | Process is up | Postgres reachable + Redis reachable |
| `chat` | Process is up (does **not** depend on `api` reachability — avoids cascading failures during `api` blips) | Postgres reachable + Redis reachable + (optional) `api` reachability for end-to-end signal |
| `mcp` | Process is up | `INTERNAL_API_SECRET` present + tool registry loads successfully |

**Render container liveness gating uses `/healthz`.** External uptime probes and deeper monitoring use `/readyz`. This separation prevents transient Redis or Postgres blips from causing Render to mark a container dead and trigger a needless redeploy.

### Observability — minimum signal stack

| Layer | Tool | Cost | Scope |
|---|---|---|---|
| Server errors | Sentry (`SENTRY_DSN_SERVER`) | Free tier | `api` / `chat` / `mcp` on Render |
| Client errors | Sentry (`NEXT_PUBLIC_SENTRY_DSN`) | Free tier (shared project, separate DSN) | Dashboard on Vercel |
| Logs | Render's built-in viewer (validate retention before launch; export to Better Stack later if needed) | Included | All Render services |
| Metrics | Render's CPU / memory / RPS dashboard | Included | All Render services |
| Uptime | UptimeRobot (free) or Better Stack | Free–$10/mo | External probe of `api/readyz` + `chat/readyz` every 5 min |
| Deploy notifications | Render + Vercel email/Slack | Included | Deploy failure alerts |
| Tracing | **Skipped at pilot** | — | Re-evaluate at exit condition |

### Alert routing

- Sentry → email to single operator at pilot. Expand to Slack channel post-launch.
- UptimeRobot → email + SMS.
- Render deploy failures → email.
- No PagerDuty rotation until a team exists.

## 8. Backups and durability

- **Postgres:** Render Starter ships automatic daily snapshots. **Validate retention period before provisioning** and document the actual retention in `docs/runbooks/production-urls.md`.
- **Restore drill cadence:**
  - **Quarterly during pilot.**
  - **Immediately before opening public launch** (transition out of hand-onboard cohort).
  - **After any major schema migration.**
  A backup that has never been restored is not a backup.
- **Redis is cache only**, not durable. Any state that must survive a Redis flush belongs in Postgres.
- **`packages/db/prisma/migrations/`** is the schema source of truth. Restoring a snapshot requires the migration directory on the commit corresponding to the snapshot date.

## 9. Exit conditions — when Render stops being the right answer

Re-evaluate hosting when **any one** of these fires:

| Trigger | Why it changes the calculus |
|---|---|
| Monthly infra cost > **$150** | Fly + Neon + Upstash becomes meaningfully cheaper at this band; the ops-overhead premium is no longer justified. |
| Webhook latency user-visible (`chat` p95 > 1s consistently) | Render Starter shared-CPU isn't keeping up; choice is upgrade tier (~$25+/mo per service) or migrate to Fly's better price/perf. |
| Postgres tier upgrade required (Starter → Standard) | Step-function cost jump. The cheapest moment to consider Neon's serverless model. |
| Active customer count > **50–100** | Pilot framing exhausted; uptime + cost + observability all need a re-look, not an incremental tweak. |
| Render-specific blocker | Region availability gap, sustained vendor outage pattern, feature gap (e.g., need autoscale that Starter doesn't offer). |

**When triggered, the response is not "migrate immediately."** Re-run the Block 1 option comparison with actual usage data, model the migration as a feature-sized project (1–3 weeks of focused work), and weigh against the next launch initiative. The discipline is: **migrate because cost-per-revenue is wrong, not because absolute cost grew.**

## 10. Launch runbook

Sequenced checklist from "spec approved" to "first real user signed up."

1. **Commit `render.yaml`** to `main` describing all backend resources (services, plans, Dockerfile targets, pre-deploy command on `api`, health-check paths, region) per §5.
2. **Provision** Render resources by connecting the repo. Render reads `render.yaml` and creates:
   - `api` (Web Service, public), `chat` (Web Service, public), `mcp` (Private Service)
   - Postgres Starter
   - Redis Starter
   - Region: per §3 *Region*, closest to primary pilot users and webhook traffic
   - Validate Starter plan limits against expected pilot traffic before accepting

3. **Vault → Render env**: copy backend secrets from password manager into each service's env settings. `INTERNAL_API_SECRET` identical across `api`/`chat`/`mcp`. `SENTRY_DSN_SERVER` set on all 3.

4. **Confirm pre-deploy command** (declared in `render.yaml`) is attached to `api` only: `pnpm --filter @switchboard/db migrate deploy`. Confirm `chat` and `mcp` have no migration command.

5. **Vercel env update:** set `NEXT_PUBLIC_API_BASE_URL` to Render `api`'s public URL; set `NEXT_PUBLIC_SENTRY_DSN`; verify no backend secrets are present on Vercel.

6. **First deploy:** push to `main` (or trigger manual deploy in Render). Watch all 3 Render builds + Vercel build complete green.

7. **Post-deploy smoke checklist:**
   - Dashboard loads at production URL.
   - Dashboard calls `api /readyz` successfully (auth'd).
   - `chat` webhook verification endpoint responds 200 to a Meta GET probe.
   - **Webhook signature verification works:** Meta webhook verification succeeds with the correct `hub.verify_token`; invalid signatures are rejected with non-200. Same for Slack signing-secret verification and Telegram secret-token verification.
   - `api` reads Postgres successfully (any authenticated route hits the DB).
   - `api` reads/writes Redis successfully (session store or rate-limit counter).
   - **Migration status verified:** `pnpm --filter @switchboard/db prisma migrate status` reports "Database schema is up to date" from a one-shot Render job, or the equivalent is visible in `api` startup logs.
   - **Inngest production-safe event smoke:** send one non-destructive production-safe Inngest event (e.g., `system/healthcheck.ping`) and verify the handler runs inside the deployed `api`. Do not use `inngest dev` for production smoke.
   - **Sentry tagged test events:** send a test event from each service tagged `environment=production, test=true`; verify the events arrive in the Sentry inbox **and that alert rules ignore them** (so test events don't page).

8. **Register webhooks** with stable production URLs:
   - WhatsApp: Meta Business Manager → callback URL = `https://<chat-domain>/webhook/managed/<channelId>`.
   - Telegram: `pnpm cli:register-webhook https://<chat-domain>/webhook/telegram`.
   - Slack: app config → event subscription URL.

9. **Tag** `v1.0.0` in git; create a GitHub release with the launch commit and a brief change-log.

10. **Document live URLs** in `docs/runbooks/production-urls.md`: Vercel + Render service URLs, Render region, monitoring dashboard links, vault entries map, plan tiers.

11. **Rollback rehearsal** (mandatory before opening the funnel): in a controlled window, either promote the previous Vercel deployment or rollback one Render service via the Render dashboard, run the smoke checklist against the rolled-back state to confirm the path actually works, then redeploy the current version. **This proves the rollback path is real, not just documented.**

12. **First-user dry run:** hand-onboard one trusted user end-to-end. Observe Sentry, Render logs, UptimeRobot, and the dashboard for 24 hours. Only after that 24-hour window passes clean do you open the funnel to additional pilot users.

## 11. Out of scope (explicit)

- Multi-region or active-active setup
- Read replicas, connection pooling beyond what Render provides
- Self-hosted Inngest, custom queue infrastructure
- Custom observability stack (OpenTelemetry collector, Grafana, Prometheus)
- Distributed tracing
- mTLS service mesh
- Compliance certifications (SOC 2, HIPAA, etc.)
- Cost optimization beyond the §8 exit conditions

Anything in this list re-enters scope only when an exit condition (§9) is triggered or when an external requirement (Meta App Review escalation, enterprise customer, compliance audit) demands it.

## 12. Related references

- [[deploy-host-vercel]] (memory): Vercel-specific dashboard env handling.
- [[contacts-pipeline-shipped]] (memory): canonical example of the env-flag kill-switch pattern.
- `docs/DOCTRINE.md`: core invariants the deployment must preserve.
- `docs/ARCHITECTURE.md`: app boundary definitions.
- `Dockerfile`: multi-stage build with targets `api`, `chat`, `dashboard`, `mcp-server`. Render consumes the first, second, and fourth. The `dashboard` target is retained for local integration testing only; production dashboard ships via Vercel.
- `docker-compose.prod.yml`: a prior self-hosted-VPS deploy plan with `nginx` + `certbot` + local `dashboard` + `db-migrate` services. **Kept for local integration testing of the backend stack only.** It is not the production deploy target under this spec; do not synchronize it with Render runtime config.
- `.github/workflows/ci.yml`, `release.yml`: existing CI shape.
