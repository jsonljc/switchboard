# Operations Runbook

## Health Checks

### Endpoints

| Service    | Endpoint               | Expected Response                                                                        |
| ---------- | ---------------------- | ---------------------------------------------------------------------------------------- |
| API        | `GET /health`          | `{ "status": "ok", "checks": { "database": "ok", "redis": "ok" }, "uptime": <seconds> }` |
| API (deep) | `GET /api/health/deep` | Detailed checks: DB, Redis, queue, worker, cartridges                                    |
| Chat       | `GET /health`          | `{ "status": "ok", "checks": { "db": "ok", "redis": "ok" }, "uptime": <seconds> }`       |

### What to look for

- **status: "degraded"** means at least one backend is unreachable. Check the `checks` object for which one.
- **HTTP 503** from health endpoints means the service considers itself unhealthy.
- Docker health checks poll `/health` every 10s; three failures mark the container unhealthy.

### Prometheus metrics

- `GET /metrics` on the API server exposes Prometheus-format metrics.
- Key metrics: request latency, queue depth, error rates.

---

## Incident Playbooks

### 1. Agent Misbehavior

**Symptoms:** Agent producing harmful, off-topic, or looping responses.

**Response:**

1. Use the emergency halt endpoint: `POST /api/agents/:deploymentId/halt`
2. Or use the dashboard: Agents > select deployment > Emergency Halt button
3. The agent's deployment status changes to `halted` and no further tasks are processed
4. Investigate the audit log: `GET /api/audit?entityId=<deploymentId>`
5. Fix the agent's identity spec or skill configuration before resuming

### 2. Meta API Rate Limit / Token Expiry

**Symptoms:** Ad optimizer or lead intake returning 429 or 401 errors.

**Response:**

1. Check the connection status: `GET /api/connections?type=facebook`
2. If token expired, the user must re-authenticate via the dashboard Connections page
3. For rate limits, the system backs off automatically. If persistent:
   - Check `META_ADS_ACCESS_TOKEN` expiry (60-day tokens)
   - Reduce ad optimizer polling frequency in deployment config
   - Check Meta Business Manager for app-level rate limit status

### 3. Database Connection Exhaustion

**Symptoms:** API returns 503, health check shows `database: "unreachable"`, Prisma logs `P2024` errors.

**Response:**

1. Check current connections: `SELECT count(*) FROM pg_stat_activity WHERE datname = 'switchboard';`
2. Check pool config in `DATABASE_URL` — `connection_limit` parameter (default: 10)
3. If maxed out, restart the API container: `docker compose -f docker-compose.prod.yml restart api`
4. For persistent issues, increase `connection_limit` in DATABASE_URL and redeploy
5. Check for long-running queries: `SELECT pid, now() - query_start AS duration, query FROM pg_stat_activity WHERE state = 'active' ORDER BY duration DESC;`

### 4. Stripe Webhook Failures

**Symptoms:** Billing events not processing, subscription status stale.

**Response:**

1. Check Stripe Dashboard > Developers > Webhooks for failed deliveries
2. Verify `STRIPE_WEBHOOK_SECRET` matches the webhook endpoint config in Stripe
3. Replay failed events from Stripe Dashboard (click "Resend" on individual events)
4. If the webhook endpoint URL changed, update it in Stripe Dashboard
5. Check API logs for webhook processing errors: `docker compose logs api | grep stripe`

### 5. Redis OOM (Out of Memory)

**Symptoms:** Rate limiting stops working, BullMQ jobs stall, idempotency cache fails.

**Response:**

1. Check Redis memory: `docker compose exec redis redis-cli INFO memory`
2. Look at `used_memory_human` vs `maxmemory`
3. Flush stale rate limit keys: `docker compose exec redis redis-cli --scan --pattern "rl:*" | head -20`
4. If BullMQ queues are backing up, check for stuck workers
5. Set a memory limit in the Redis config: add `--maxmemory 256mb --maxmemory-policy allkeys-lru` to the redis command in docker-compose

---

## Rate Limits

| Route Pattern           | Limit    | Window   | Layer   |
| ----------------------- | -------- | -------- | ------- |
| All routes (global)     | 100 req  | 60s      | Fastify |
| `/api/auth/*`           | 5 req    | 60s      | App     |
| `/api/setup/bootstrap`  | 5 req    | 60s      | App     |
| `/api/billing/checkout` | 5 req    | 60s      | App     |
| `/api/*` (nginx)        | 10 req/s | burst 20 | Nginx   |
| `/webhook/*` (nginx)    | 30 req/s | burst 50 | Nginx   |

---

## Deployment Rollback

1. Identify the last known good image tag or commit
2. Update the image reference or checkout the previous commit
3. Rebuild and deploy:
   ```bash
   docker compose -f docker-compose.prod.yml build
   docker compose -f docker-compose.prod.yml up -d
   ```
4. Database migrations are forward-only. If a migration caused the issue:
   - Do NOT run `prisma migrate reset` in production
   - Write a new migration to revert the schema change
   - Apply with `docker compose -f docker-compose.prod.yml run db-migrate`

---

## Database Backup & Restore

### Automated Backups

The `db-backup` service in `docker-compose.prod.yml` runs `pg_dump` daily and retains 30 days of backups in the `db_backups` volume.

### Manual Backup

```bash
docker compose -f docker-compose.prod.yml exec postgres pg_dump -U switchboard switchboard | gzip > backup_$(date +%Y%m%d).sql.gz
```

### Restore

```bash
# Stop services that connect to the database
docker compose -f docker-compose.prod.yml stop api chat dashboard

# Restore from backup
gunzip -c backup_YYYYMMDD.sql.gz | docker compose -f docker-compose.prod.yml exec -T postgres psql -U switchboard switchboard

# Restart services
docker compose -f docker-compose.prod.yml up -d api chat dashboard
```

---

## Escalation Path

1. **Automated alerts** — Sentry captures 5xx errors and unhandled exceptions
2. **First response** — Check health endpoints, container logs, recent deploys
3. **Database issues** — Check connection pool, long queries, disk space
4. **Unresolvable** — Escalate to the owner with: affected service, error logs, timeline, actions taken
