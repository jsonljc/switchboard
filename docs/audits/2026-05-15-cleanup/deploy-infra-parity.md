# deploy-infra-parity

**Charter:** Verify deploy/infra plumbing: Vercel env vars vs `.env.example`, Render config, Sentry coverage gaps, cron registration, and Inngest function inventory + DLQ verification (centerpiece sub-audit).

**Method:** Enumerated all 11 `createFunction(...)` calls from pre-dispatch baseline; verified `retries`, `onFailure`, and DLQ handler presence for each. Cross-checked registered functions in `apps/api/src/bootstrap/inngest.ts` against 5 cron files. Verified Sentry initialization in 4 apps. Confirmed `.env.example` parity. No `infra/` directory found; Vercel config not present.

**Scope exclusions applied:** `.github/workflows/**`, root `package.json`, `turbo.json`, `apps/dashboard/next.config.mjs` excluded; `.env.example` read-only.

## Inngest function inventory + DLQ verification

### Per-file enumeration

| File                                                         | Function                        | Retries     | onFailure | DLQ                           |
| ------------------------------------------------------------ | ------------------------------- | ----------- | --------- | ----------------------------- |
| `apps/api/src/services/cron/pcd-registry-backfill.ts`        | createPcdRegistryBackfillCron   | 3           | **NONE**  | **NONE**                      |
| `apps/api/src/services/cron/reconciliation.ts`               | createReconciliationCron        | 2           | **NONE**  | **NONE**                      |
| `apps/api/src/services/cron/reconciliation.ts`               | createStripeReconciliationCron  | 2           | **NONE**  | **NONE**                      |
| `apps/api/src/services/cron/meta-token-refresh.ts`           | createMetaTokenRefreshCron      | 2           | **NONE**  | **NONE**                      |
| `apps/api/src/services/cron/lifecycle-stalled-sweep.ts`      | createLifecycleStalledSweepCron | 2           | **NONE**  | **NONE**                      |
| `apps/api/src/services/cron/lead-retry.ts`                   | createLeadRetryCron             | 2           | **NONE**  | **NONE**                      |
| `apps/api/src/bootstrap/inngest.ts`                          | dailyPatternDecayCron           | 2           | **NONE**  | **NONE**                      |
| `packages/creative-pipeline/src/mode-dispatcher.ts`          | createModeDispatcher            | 3           | **NONE**  | **NONE**                      |
| `packages/creative-pipeline/src/creative-job-runner.ts`      | createCreativeJobRunner         | 3           | **NONE**  | **NONE**                      |
| `packages/creative-pipeline/src/ugc/ugc-job-runner.ts`       | createUgcJobRunner              | 3           | **NONE**  | partial (internal phaseError) |
| `packages/ad-optimizer/src/inngest-functions.ts`             | createWeeklyAuditCron           | 2           | **NONE**  | **NONE**                      |
| `packages/ad-optimizer/src/inngest-functions.ts`             | createDailyCheckCron            | 2           | **NONE**  | **NONE**                      |
| `packages/ad-optimizer/src/inngest-functions.ts`             | createDailySignalHealthCron     | 2           | **NONE**  | **NONE**                      |
| `packages/core/src/skill-runtime/batch-executor-function.ts` | createBatchExecutorFunction     | default (3) | **NONE**  | **NONE** + **NOT REGISTERED** |

### Summary metrics

- Total functions: 14 (11 files; some files contain multiple functions)
- Functions with `retries > 0`: 14
- Functions with `onFailure` handler: **0**
- Functions with DLQ path: **0**

### Delta against launch-blocker #18 (creative-pipeline DLQ)

**Status: STILL-OPEN with expanded scope.**

Original evidence (2026-04-29): "All 3 Inngest functions have `retries: 3` but no `onFailure` handler."

Updated finding (2026-05-15): The issue is **NOT limited to creative-pipeline**: the entire codebase has **0 of 14 Inngest functions with `onFailure` handlers**. Per DOCTRINE §7: functions with `retries > 1` MUST define `onFailure` with explicit DLQ emission or operator escalation.

## Findings

### [CRITICAL] No Inngest `onFailure` handlers across entire async job surface

- **Where:** 14 Inngest functions across 11 files (see table above)
- **Evidence:** Every `createFunction({retries: N, ...})` definition lacks an `onFailure` block. Files: `apps/api/src/services/cron/*` (5 crons), `apps/api/src/bootstrap/inngest.ts` (dailyPatternDecayCron), `packages/creative-pipeline/src/{mode-dispatcher,creative-job-runner,ugc/ugc-job-runner}.ts` (3), `packages/ad-optimizer/src/inngest-functions.ts` (3), `packages/core/src/skill-runtime/batch-executor-function.ts` (1)
- **Why it matters:** When max retries are exhausted, failed job state is abandoned with no error event, no DLQ record, no operator notification. Impact: stuck leads, silent pattern-decay failures, undetected Stripe reconciliation divergence, silently-abandoned creative-pipeline jobs.
- **Fix:** Define `onFailure` handler for each function. Emit `{functionId}.failed` event on exhaustion. Wire FailedMessageStore / OutboxEvent for DLQ persistence. Operator alert on critical failures (lead exhaustion, Stripe divergence). Reference: `.audit/08-launch-blocker-sequence.md` blocker #18.
- **Effort:** L (14 functions × handler + DLQ store wiring)
- **Risk if untouched:** Job exhaustion is silent; production failures invisible
- **Collides with active work?:** no

### [HIGH] batch-executor-function exported but not registered

- **Where:** `packages/core/src/skill-runtime/batch-executor-function.ts:15-52`
- **Evidence:** `createBatchExecutorFunction()` defined and exported from `packages/core/src/skill-runtime/index.ts`; zero callsites in codebase; not passed to any `app.register(inngestFastify, { client, functions: [...] })`
- **Why it matters:** Skill runtime batch execution unavailable in production. If ad-optimizer or other skills emit `skill-runtime/batch.requested` events, they will fail with "no handler" error.
- **Fix:** Either instantiate and register in bootstrap, OR remove if deferred to future phase
- **Effort:** S (decision + 1-2 lines either way)
- **Risk if untouched:** Dead export suggests incomplete refactoring
- **Collides with active work?:** no

### [HIGH] Sentry not initialized in mcp-server app

- **Where:** `apps/mcp-server/src/` — no `sentry.ts` or equivalent
- **Evidence:** Three apps initialize Sentry (`apps/api/src/bootstrap/sentry.ts`, `apps/chat/src/bootstrap/sentry.ts`, `apps/dashboard/sentry.server.config.ts`); `grep -r "Sentry" apps/mcp-server/src/` returns no matches
- **Why it matters:** MCP tool execution errors and session failures go unmonitored in production
- **Fix:** Create `apps/mcp-server/src/sentry.ts`; call `Sentry.init({ dsn: process.env.SENTRY_DSN_SERVER, ... })` early in `apps/mcp-server/src/main.ts`. `SENTRY_DSN_SERVER` already in `.env.example`.
- **Effort:** S
- **Risk if untouched:** Can't diagnose MCP-side outages in production
- **Collides with active work?:** no

### [MED] dailyPatternDecayCron lacks onFailure

- **Where:** `apps/api/src/bootstrap/inngest.ts:274-289`
- **Evidence:** `dailyPatternDecayCron` defined with `retries: 2`, idempotency via dateMath, NO `onFailure`
- **Why it matters:** Memory decay failures undetected; if cron fails, deployment memory is frozen → users' behavioral history doesn't decay per policy
- **Fix:** Add `onFailure` emitting `memory.pattern-decay.failed`; consider alert if daily decay missed >2 consecutive days
- **Effort:** S
- **Risk if untouched:** Behavioral memory accumulates without decay
- **Collides with active work?:** no

### [LOW] No `infra/` directory for Render deployment config

- **Where:** Repository root — no `infra/` directory
- **Evidence:** `find /Users/jasonli/switchboard -type d -name "infra"` returns no results; no `vercel.json`; deploy config presumably in Vercel/Render web UI only
- **Why it matters:** No version-controlled deploy config snapshot; deployment reproducibility limited; incident recovery harder if account compromised
- **Fix:** Export Render service configs to `infra/render.yml`; document env-var sourcing; version-control as IaC
- **Effort:** M
- **Risk if untouched:** Configuration drift between dev knowledge and prod reality
- **Collides with active work?:** no

### [LOW] Cron registration lacks operator-visibility completion events

- **Where:** `apps/api/src/bootstrap/inngest.ts:614-649`
- **Evidence:** All 5 cron functions correctly wired, but none emit completion events (e.g., `cron.meta-token-refresh.completed` with result metrics). Operators must tail logs to verify cron health.
- **Why it matters:** Silent successes possible (e.g., pcd-registry-backfill processes 0 jobs but succeeds → invisible to ops)
- **Fix:** Each cron emits completion event with result metrics; wire dashboard widget to consume; add alerting rules on anomalies
- **Effort:** M
- **Risk if untouched:** Operator visibility gap
- **Collides with active work?:** no

## Out of scope / deferred for this lane

- **Inngest Cloud signing keys** (`INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`): documented in `.env.example` lines 254–255; required only for prod
- **Vercel / Render infra-as-code**: ops debt, not launch blocker
- **MCP batch-executor registration**: dead code review pending decision
- **Pattern-decay cron inline bootstrap**: working as-is; enhancement only

## Env-var parity check

`NEXTAUTH_URL` (line 158), `STRIPE_SECRET_KEY` (line 301), `STRIPE_WEBHOOK_SECRET` (line 302) all verified present in `.env.example`. No env-var gaps found.
