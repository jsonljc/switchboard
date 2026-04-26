# J5: Day-2 Ops — Readiness Audit

> **Audit date:** 2026-04-26
> **Auditor:** Claude
> **Spec:** docs/superpowers/specs/2026-04-26-self-serve-readiness-audit-design.md

## Findings

---

### [P1] J5.1 — Reliability & State Integrity

**Meta token refresh cron has no operator notification on failure**

**Evidence:** `apps/api/src/services/cron/meta-token-refresh.ts:80-84` — when a token refresh fails, the connection is marked `needs_reauth` and a `console.warn` is emitted, but no notification is sent to the operator (no email, no webhook, no dashboard alert). The operator has no way to discover that their Meta Ads connection has silently degraded until they notice campaigns stop running.

```typescript
console.warn(`[meta-token-refresh] Failed to refresh connection ${conn.id}: ${msg}`);
await deps.updateStatus(conn.id, "needs_reauth");
```

**Customer Impact:** Operator's Meta Ads integration silently stops working. Token expires, ads stop running, revenue impact goes unnoticed for days.

**Fix:** Add an operator notification channel (email or dashboard alert) when a connection transitions to `needs_reauth`. (scope: hours)

---

### [P2] J5.1 — Completeness

**Reconciliation cron is a stub**

**Evidence:** `apps/api/src/bootstrap/inngest.ts:196-206` — the `runReconciliation` dependency is stubbed to always return `{ overallStatus: "healthy" }`. No actual reconciliation checks are performed.

```typescript
runReconciliation: async (orgId, dateRange) => {
  // Stub — full wiring requires booking/conversion/opportunity stores
  // Returns healthy by default; real implementation connects ReconciliationRunner
  return {
    organizationId: orgId,
    overallStatus: "healthy",
    checks: [],
    ...
  };
},
```

**Customer Impact:** None directly — the cron runs but reports everything as healthy regardless of actual state. Reconciliation gaps (missing conversions, orphaned bookings) go undetected.

**Fix:** Wire `ReconciliationRunner` to real stores (booking, conversion, opportunity). (scope: days)

---

### [P2] J5.1 — Completeness

**CRM and Insights providers in ad optimizer are stubs**

**Evidence:** `apps/api/src/bootstrap/inngest.ts:85-129` — both `createCrmProvider` and `createInsightsProvider` return hardcoded zero/default values. The weekly audit and daily check crons execute but produce meaningless results.

```typescript
createCrmProvider: (_deploymentId) => ({
  getFunnelData: async () => ({ campaignIds: [], leads: 0, ... }),
  ...
}),
createInsightsProvider: (_adsClient) => ({
  getCampaignLearningData: async () => ({ effectiveStatus: "ACTIVE", learningPhase: false, ... }),
  ...
}),
```

**Customer Impact:** Ad optimization audits run but provide no actionable intelligence. Operators see audit tasks with empty/default data.

**Fix:** Connect real Meta Campaign Insights and CRM data sources. (scope: days)

---

### [P1] J5.1 — Ops Readiness

**Meta token refresh cron depends on Inngest infrastructure with no visibility**

**Evidence:** `apps/api/src/bootstrap/inngest.ts:293-322` — all cron functions are registered via Inngest's serve handler at `/api/inngest`. There is no monitoring for whether Inngest is actually invoking these crons. If the Inngest Cloud connection fails or the serve endpoint is unreachable, all 5 crons (token refresh, weekly audit, daily check, reconciliation, lead retry) silently stop executing. No alerting exists for cron execution failures.

**Customer Impact:** All automated maintenance silently stops. Tokens expire, leads are not retried, audits stop running.

**Fix:** Add a cron heartbeat check — each cron should write a "last executed" timestamp; a health check should alert if any cron has not run within 2x its expected interval. (scope: hours)

---

### [P2] J5.2 — Completeness

**Health endpoints are well-implemented with 503 on degraded**

**Evidence:** `apps/api/src/app.ts:451-488` — the `/health` endpoint checks DB and Redis with 3-second timeouts, returns 503 on failure. `apps/api/src/routes/health.ts:133` — the `/api/health/deep` endpoint checks DB, Redis, queue, worker, and cartridges, returning 503 when any is unhealthy.

`apps/chat/src/main.ts:152-188` — chat server has a `/health` endpoint checking DB and Redis.

**Customer Impact:** None — this is working correctly.

**Fix:** No fix needed.

---

### [P1] J5.2 — Reliability & State Integrity

**Chat health endpoint creates a new Redis connection on every call**

**Evidence:** `apps/chat/src/main.ts:169-179` — the health check creates a `new Redis(...)` connection, pings, and quits on every invocation. At 10-second intervals from Docker healthcheck, this creates 6 connections per minute that must be established and torn down.

```typescript
if (process.env["REDIS_URL"]) {
  try {
    const Redis = (await import("ioredis")).default;
    const redisClient = new Redis(process.env["REDIS_URL"]);
    await redisClient.ping();
    await redisClient.quit();
    checks["redis"] = "ok";
  } catch {
```

**Customer Impact:** Unnecessary connection churn. Under load, Redis connection exhaustion could cause false-negative health checks leading to container restarts.

**Fix:** Reuse the shared Redis client initialized at startup (line 95) instead of creating ephemeral connections. (scope: hours)

---

### [P1] J5.2 — Reliability & State Integrity

**Chat health endpoint has no timeout on DB/Redis checks**

**Evidence:** `apps/chat/src/main.ts:157-179` — unlike the API server which wraps checks in a 3-second timeout (`apps/api/src/app.ts:455-459`), the chat server has no timeout. A hung database connection will cause the health check to hang indefinitely, preventing Docker from getting a timely response.

**Customer Impact:** Docker healthcheck times out after 5 seconds and marks the container unhealthy even though the service may be functional (just the DB is slow). Could trigger unnecessary container restarts.

**Fix:** Add a timeout wrapper (3 seconds) matching the API server's pattern. (scope: hours)

---

### [P0] J5.3 — Ops Readiness

**Chat server has no Sentry integration**

**Evidence:** Searched `apps/chat/src/` for any reference to `@sentry` or `sentry` — zero results. The API server has `apps/api/src/bootstrap/sentry.ts` wired into the error handler. The dashboard has `apps/dashboard/sentry.client.config.ts` and `apps/dashboard/sentry.server.config.ts`. The chat server — which handles all customer-facing WhatsApp and Telegram messages — has no error monitoring whatsoever beyond local Pino logs.

**Customer Impact:** Errors in the customer-facing chat pipeline (WhatsApp message handling, webhook processing, managed channel failures) are invisible to operations. A crash loop or systematic error goes undetected until customers complain.

**Fix:** Add Sentry initialization to `apps/chat/src/main.ts` following the same pattern as `apps/api/src/bootstrap/sentry.ts`. Wire it into the error handler at line 111. (scope: hours)

---

### [P1] J5.4 — Security

**No Pino log redaction configured — potential secret leakage in structured logs**

**Evidence:** `apps/api/src/app.ts:80-87` and `apps/chat/src/main.ts:37-42` — both servers configure Pino logger without any `redact` option. Pino's structured JSON logging in production will serialize entire request/response objects. If a request body or header contains a token, API key, or credential, it will appear in plaintext in log output.

```typescript
const app = Fastify({
  logger: {
    level: logLevel,
    ...(process.env.NODE_ENV === "production" ? {} : { transport: { target: "pino-pretty" } }),
  },
});
```

No `serializers` or `redact` configuration is present.

**Customer Impact:** Secrets could appear in log aggregation systems (CloudWatch, Datadog, etc.), accessible to anyone with log access. Violates principle of least exposure for credentials.

**Fix:** Add Pino `redact` paths for known sensitive fields: `["req.headers.authorization", "req.headers.x-api-key", "body.credentials", "body.accessToken", "body.password"]`. (scope: hours)

---

### [P2] J5.5 — Completeness

**Database backup automation exists but uses local Docker volume**

**Evidence:** `docker-compose.prod.yml:188-211` — a `db-backup` service runs `pg_dump` daily with 30-day retention. However, backups are stored in a Docker volume (`db_backups`) on the same host as the database.

```yaml
db-backup:
  image: pgvector/pgvector:pg16
  entrypoint: >
    /bin/sh -c '
      ...
      pg_dump "$$DATABASE_URL" | gzip > "$${BACKUP_FILE}";
      find /backups -name "switchboard_*.sql.gz" -mtime +30 -delete;
      ...
    '
  volumes:
    - db_backups:/backups
```

**Customer Impact:** If the host machine fails (disk failure, cloud instance termination), both the database and all backups are lost simultaneously. This is not a real disaster recovery strategy.

**Fix:** Add S3/GCS upload step after pg_dump, or mount an external/network-attached volume for backups. (scope: hours)

---

### [P2] J5.5 — Ops Readiness

**No backup verification or alerting**

**Evidence:** `docker-compose.prod.yml:188-211` — the backup script has no error handling on `pg_dump` failure (pipeline errors are silently swallowed by the shell), no backup size validation, and no alerting when a backup fails or is suspiciously small. The `restart: "no"` policy means if the backup container crashes, it never restarts.

**Customer Impact:** Backups could silently fail for weeks. Operator discovers backup gap only during a disaster recovery event.

**Fix:** Add `set -e` to the script, validate backup file size > 0, add health check or alert on failure, change restart policy to `unless-stopped`. (scope: hours)

---

### [P2] J5.6 — Completeness

**Deployment path is well-structured with migration ordering**

**Evidence:** `docker-compose.prod.yml` — migration runs as a separate `db-migrate` service with `restart: "no"`, and the API service depends on it with `condition: service_completed_successfully`. This ensures migrations complete before the API starts. All services have health checks, `restart: unless-stopped`, and proper dependency ordering.

**Customer Impact:** None — this is working correctly.

**Fix:** No fix needed.

---

### [P1] J5.6 — Reliability & State Integrity

**No zero-downtime deployment strategy**

**Evidence:** `docker-compose.prod.yml` — there is no rolling update configuration. `docker compose up` will stop and restart containers, causing downtime. There is no blue-green or canary deployment mechanism. Nginx upstream blocks (`nginx/nginx.conf:23-31`) reference single server entries with no failover.

```nginx
upstream api {
    server api:3000;
}
```

**Customer Impact:** Every deployment causes a brief outage. WhatsApp webhook messages arriving during deployment are lost (Meta will retry, but with delays). Customer conversations are interrupted.

**Fix:** Implement rolling updates (Docker Swarm mode or Kubernetes), or add multiple upstream servers with health checks in Nginx. (scope: days)

---

### [P1] J5.6 — Security

**Nginx TLS config has placeholder domain**

**Evidence:** `nginx/nginx.conf:57-58` — SSL certificate paths contain literal `DOMAIN` placeholder that must be manually replaced before deployment.

```nginx
ssl_certificate /etc/letsencrypt/live/DOMAIN/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/DOMAIN/privkey.pem;
```

**Customer Impact:** If deployed without replacing `DOMAIN`, Nginx will fail to start and the entire production stack will be unreachable. This is a manual step that could be missed.

**Fix:** Use environment variable substitution (envsubst) or document the replacement step in a deployment checklist. (scope: hours)

---

### [P1] J5.7 — Reliability & State Integrity

**Redis failure crashes the API server on startup — no graceful degradation**

**Evidence:** `apps/api/src/bootstrap/storage.ts:81-83` — Redis is initialized with `new IORedis(redisUrl)` with no error handler. If Redis is unreachable at startup, the connection will emit an error event. IORedis defaults to reconnecting, but there is no `maxRetriesPerRequest` or error event handler configured. A Redis failure during operation will cause unhandled errors in rate limiting, idempotency, guardrail state, and the BullMQ execution queue.

```typescript
if (redisUrl) {
  const { default: IORedis } = await import("ioredis");
  redis = new IORedis(redisUrl);
}
```

No `.on("error", ...)` handler is attached.

**Customer Impact:** If Redis goes down after startup, operations that depend on Redis (rate limiting, idempotency, queue) will throw unhandled errors. These bubble up as 500s to customers.

**Fix:** Add error event handler on the Redis client, configure `maxRetriesPerRequest`, and implement graceful degradation (fall back to in-memory for rate limiting/idempotency). (scope: hours)

---

### [P1] J5.7 — Reliability & State Integrity

**Chat server Redis failure is caught but warning goes to console.warn**

**Evidence:** `apps/chat/src/main.ts:99-101` — Redis initialization failure in the chat server is caught and logged with `console.warn`, which is correct for fallback behavior. However, the fallback path uses in-memory rate limiting and dedup, which means a Redis outage silently degrades security (rate limits are per-instance, not distributed; dedup is per-instance, not cross-replica).

```typescript
} catch (err) {
  console.warn("Failed to initialize Redis security store, using in-memory fallback:", err);
}
```

**Customer Impact:** During Redis outage, rate limiting and dedup become per-instance. An attacker could bypass rate limits by distributing requests across instances. Duplicate webhook messages could be processed, causing double responses to customers.

**Fix:** Log the degradation as a structured warning via `app.log.warn` (not `console.warn`), and surface the degraded state in the health endpoint. (scope: hours)

---

### [P2] J5.8 — Completeness

**Rate limiting is multi-layered and well-implemented**

**Evidence:**

- `apps/api/src/app.ts:111-114` — global `@fastify/rate-limit` with configurable max/window.
- `apps/api/src/middleware/rate-limit.ts` — additional in-memory rate limiter for sensitive endpoints (`/api/auth`, `/api/setup/bootstrap`, `/api/billing/checkout`) at 5 requests/minute.
- `nginx/nginx.conf:19-20` — Nginx layer rate limiting at 10 req/s for API, 30 req/s for webhooks.
- `apps/chat/src/main.ts:104-108` — webhook ingress rate limiting with configurable window/max.

**Customer Impact:** None — this is working correctly. Three layers of defense (Nginx, Fastify global, endpoint-specific).

**Fix:** No fix needed.

---

### [P2] J5.8 — Reliability & State Integrity

**Auth rate limiter is in-memory only — not shared across instances**

**Evidence:** `apps/api/src/middleware/rate-limit.ts:26` — the sensitive-endpoint rate limiter uses a `Map<string, RateLimitEntry>()` which is per-process. In a multi-instance deployment, an attacker can send 5 requests to each instance, effectively multiplying the rate limit by the number of instances.

```typescript
function authRateLimitPlugin(app: FastifyInstance, _opts: unknown, done: () => void) {
  const store = new Map<string, RateLimitEntry>();
```

The comment at line 22-23 acknowledges this: "if Redis is available via app.redis, the global @fastify/rate-limit plugin already provides distributed limiting." However, the auth-specific limiter (5 req/min for login/setup/billing) is always in-memory regardless.

**Customer Impact:** In multi-instance deployments, brute-force protection on auth endpoints is weakened proportionally to instance count. The Nginx rate limit (10 req/s) provides a coarser backstop.

**Fix:** Use Redis-backed rate limiting for the auth endpoints when `app.redis` is available. (scope: hours)

---

### [P0] J5.3 — Self-Serve Integrity

**No alerting pipeline — all monitoring is passive**

**Evidence:** Across the entire codebase, there is no alerting mechanism. Sentry captures errors (API + dashboard only), Prometheus metrics are exposed at `/metrics`, and health endpoints return 503 — but nothing sends proactive alerts. There is no PagerDuty, OpsGenie, Slack webhook, or email integration. The system relies entirely on someone actively polling health endpoints or checking Sentry.

The docker-compose health checks will restart unhealthy containers (via `restart: unless-stopped`), but there is no notification that a restart occurred or that the system is in a restart loop.

**Customer Impact:** System failures are not detected until a customer reports them. A crash-looping container, expired token, or failed backup can persist for hours or days without anyone noticing.

**Fix:** Integrate an alerting provider (PagerDuty, OpsGenie, or at minimum Slack webhooks) triggered by: Sentry error spikes, health check failures, cron heartbeat misses, container restart events. (scope: days)

---

## Summary

| Priority | Count | Key Themes                                                                                                                                                                                     |
| -------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | 2     | No Sentry on chat server; no alerting pipeline                                                                                                                                                 |
| P1       | 8     | Token refresh notification gap; chat health check bugs; no log redaction; Redis error handling; no zero-downtime deploy; Inngest cron visibility; nginx placeholder; in-memory auth rate limit |
| P2       | 5     | Stubbed reconciliation/CRM; local-only backups; no backup verification; auth rate limit not distributed (acknowledged)                                                                         |

**Status: DONE**
