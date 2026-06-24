# A5b — Robin recovery-send bounded-retry machinery — Implementation Plan

> **For agentic workers:** executed via the build-loop EXECUTE phase (TDD, one step at a time, RED proof before GREEN). This is `.claude/` scratch (uncommitted), NOT a `docs/` plan on the impl branch (branch doctrine). STATE_LEDGER: `.claude/agents-fix-A5-loop-state.md`.

**Goal:** A TRANSIENT Robin recovery-send failure is reclaimed up to a bounded N with capped-exponential + full-jitter backoff, then dead-letters with a per-recipient failure metric + a high-ratio operator alert; terminal outcomes (sent / consent-skip / no-phone / rebooked / draft-template) stay permanent and are never retried; every retry re-validates consent + template at retry time and submits through PlatformIngress with the seeded `system` principal.

**Architecture:** Mirror the ScheduledFollowUp prior art. The retry re-send re-uses the SAME row by id (single-row reclaim, NO new dedup row, NO dedup-key epoch). A NEW auto-execute intent `robin.recovery_send.retry` (the cohort intent `robin.recovery_campaign.send` PARKS for human approval — reuse would defeat auto-retry) is submitted PER-ROW by a new `*/15` cron (`findDue` → per-row `step.run` → ingress), giving Inngest per-row memoization. A shared `dispatchRecoveryRow` + `computeRecoveryNextRetry` (new `robin-recovery-send-core.ts`) is the one send+consent+template+state+backoff path; the cohort executor and the retry executor both call it, so a cohort send-failure now schedules retry-1 (the D4 behavior change) and only the retry executor ever dead-letters (computeNextRetry(0) is always non-terminal at MAX=3).

**Tech Stack:** TypeScript ESM monorepo, Prisma, Inngest crons, Zod, Vitest, prom-client.

## Global Constraints

- Layers: schemas → core → db → apps (no cycles). The retry tuning constants live in **core** (`packages/core/src/recovery/robin-recovery-send-store.ts`) so both the db store (`findDue`) and the api core (`computeRecoveryNextRetry`) import one source of truth.
- ESM, `.js` extensions on relative imports. No `console.log`. No `any`. No em-dashes in copy/comments. Prettier: double quotes, semis, 100-col. Lowercase commit subjects.
- Pre-commit hook runs eslint + prettier ONLY (NOT tsc). Run `pnpm --filter <pkg> exec tsc --noEmit` per touched package before EVERY commit.
- Single-row `update` by id (mirror prior art); never `updateMany` (drops the no-match abort).
- Merge-stop globs touched (prisma + external send + governance) → SURFACE-before-merge.
- `MAX_SEND_ATTEMPTS=3` (1 cohort attempt + 2 retries); `BASE=15m`; `CAP=6h`; `MAX_AGE=24h`; full jitter via an injectable `random:()=>number` (default `Math.random`).

## File Structure

**Create:**

- `apps/api/src/bootstrap/robin-recovery-send-core.ts` — shared: `computeRecoveryNextRetry`, `dispatchRecoveryRow`, `isOrgConfigSkip`, `evaluateRecoveryEligibility`, `RECOVERY_INTENT_CLASS`, the moved `RecoverySendContext` / `RecoveryTemplateSendArgs` / `RecoveryTemplateSendResult` / `defaultSendTemplate`.
- `apps/api/src/bootstrap/__tests__/robin-recovery-send-core.test.ts`
- `apps/api/src/services/cron/robin-recovery-retry-dispatch.ts` — the `*/15` retry cron.
- `apps/api/src/services/cron/__tests__/robin-recovery-retry-dispatch.test.ts`
- `packages/db/prisma/migrations/<ts>_robin_recovery_send_retry/migration.sql`

**Modify:**

- `packages/schemas/src/robin-recovery.ts` (+barrel `index.ts`) — `RobinRecoveryRetryParamsSchema`.
- `packages/core/src/recovery/robin-recovery-send-store.ts` (+barrel) — `markFailed` 3-arg, `findDue`, `DueRobinRecoverySend`, the 4 constants. Update the doc comment.
- `packages/core/src/telemetry/metrics.ts` — `robinRecoverySendFailed` (interface + `createInMemoryMetrics`).
- `packages/db/src/stores/prisma-robin-recovery-send-store.ts` (+test) — `findDue`, `markFailed` 3-arg.
- `packages/db/prisma/schema.prisma` — `attempts`, `nextRetryAt`, `@@index([status, nextRetryAt])`.
- `packages/db/src/seed/robin-recovery-governance.ts` (+test) — third allow-only retry policy.
- `apps/api/src/metrics.ts` + `apps/chat/src/bootstrap/metrics.ts` — `robinRecoverySendFailed` PromCounter.
- `apps/api/src/bootstrap/robin-recovery-executor.ts` (+test) — cohort uses `dispatchRecoveryRow`; new `buildRobinRecoverySendRetryExecutor`.
- `apps/api/src/__tests__/robin-recovery-approval-loop.test.ts` — in-memory store `markFailed` 3-arg + `findDue`.
- `apps/api/src/services/workflows/robin-recovery-request.ts` — `ROBIN_RECOVERY_RETRY_INTENT`, `buildRecoveryRetrySubmitRequest`.
- `apps/api/src/bootstrap/platform-deployment-resolver.ts` (+test) — add the retry intent to `PLATFORM_DIRECT_WORKFLOW_INTENTS`.
- `apps/api/src/bootstrap/contained-workflows.ts` — register the retry handler + intent (`approvalPolicy:"none"`), shared `getRecoverySendContext` closure, return `submitRecoveryRetry`.
- `apps/api/src/app.ts` — capture + thread `submitRecoveryRetry`.
- `apps/api/src/bootstrap/inngest.ts` — `robinRecoverySendStore` instance, `robinRecoveryRetryDispatchDeps`, register `createRobinRecoveryRetryDispatchCron`, `submitRecoveryRetry?` option.

**Commit grouping (squash at merge):** T1-T3 (schema+core+db+migration); T4 (metrics x3); T5-T7 (api core+executors); T8-T9 (request+resolver+cron); T10 (governance); T11 (wiring).

---

### Task 1: schemas + core store iface + retry constants

**Files:**

- Modify: `packages/schemas/src/robin-recovery.ts` + `packages/schemas/src/index.ts`
- Modify: `packages/core/src/recovery/robin-recovery-send-store.ts` + barrel `packages/core/src/recovery/index.ts`
- Test: `packages/schemas/src/__tests__/robin-recovery.test.ts` (or co-located existing)

**Interfaces — Produces:**

- `RobinRecoveryRetryParamsSchema` = `z.object({ rowId: z.string().min(1), contactId: z.string().min(1), bookingId: z.string().min(1), campaignKind: z.string().min(1), attempts: z.number().int().nonnegative() })`; `type RobinRecoveryRetryParams = z.infer<...>`.
- `interface DueRobinRecoverySend { id; organizationId; contactId; bookingId; campaignKind; attempts }` (all string except attempts: number).
- `RobinRecoverySendStore.findDue(now: Date, limit: number): Promise<DueRobinRecoverySend[]>`; `markFailed(id: string, error: string, nextRetryAt: Date | null): Promise<void>`.
- `export const ROBIN_RECOVERY_MAX_SEND_ATTEMPTS = 3; ROBIN_RECOVERY_RETRY_BASE_MS = 15*60*1000; ROBIN_RECOVERY_RETRY_CAP_MS = 6*60*60*1000; ROBIN_RECOVERY_RETRY_MAX_AGE_MS = 24*60*60*1000;`

- [ ] **Step 1 (RED):** In the schemas test, add `it("RobinRecoveryRetryParamsSchema rejects empty rowId and accepts a full payload")` asserting `.safeParse({rowId:"",...}).success === false` and a full valid payload `.success === true`. Run `pnpm --filter @switchboard/schemas test -- robin-recovery` → FAIL (schema undefined).
- [ ] **Step 2 (GREEN):** Add `RobinRecoveryRetryParamsSchema` + type to `robin-recovery.ts`; export from the schemas barrel. Run the test → PASS.
- [ ] **Step 3:** Edit the core iface: change `markFailed` to 3-arg, add `findDue` + `DueRobinRecoverySend` + the 4 constants; replace the doc comment line "Single-attempt: markFailed is terminal (no retry)..." with "Bounded retry: markFailed re-queues (status pending + nextRetryAt) until attempts reach ROBIN_RECOVERY_MAX_SEND_ATTEMPTS, then dead-letters (status failed). findDue reclaims only EXPLICITLY-rescheduled rows (nextRetryAt set); fresh rows belong to the cohort executor." Export the constants + `DueRobinRecoverySend` from the core barrel.
- [ ] **Step 4:** `pnpm --filter @switchboard/schemas exec tsc --noEmit && pnpm --filter @switchboard/core exec tsc --noEmit`. The core compiles (the impl in db is updated in T3; core itself only declares the iface). Expected: core PASS (iface only). **Commit** after T3 (the iface change reds the db impl typecheck until T3 lands; sequence T1→T2→T3 then commit the group).

### Task 2: migration — attempts + nextRetryAt + index

**Files:**

- Modify: `packages/db/prisma/schema.prisma` (model `RobinRecoverySend`, lines ~2317-2334)
- Create: `packages/db/prisma/migrations/<ts>_robin_recovery_send_retry/migration.sql`

- [ ] **Step 1:** Add to the model after `updatedAt`:

```prisma
  attempts           Int       @default(0)
  nextRetryAt        DateTime?
```

and a second index under the existing one:

```prisma
  @@index([organizationId, bookingId])
  @@index([status, nextRetryAt])
```

- [ ] **Step 2 (hand-author the migration; `db:check-drift` is the real gate):** The DDL is deterministic and trivial, so hand-author it (avoids the shadow-DB-URL fragility: `.env.example`'s `DATABASE_URL` carries a `?connection_limit=...` query string that mangles a `basename ... _shadow` shadow name). Create `packages/db/prisma/migrations/<ts>_robin_recovery_send_retry/migration.sql` (`<ts>` = a new monotonic `YYYYMMDDHHMMSS`, after the latest existing migration dir) with EXACTLY:

```sql
-- AlterTable
ALTER TABLE "RobinRecoverySend" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "nextRetryAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "RobinRecoverySend_status_nextRetryAt_idx" ON "RobinRecoverySend"("status", "nextRetryAt");
```

Index name `RobinRecoverySend_status_nextRetryAt_idx` is 40 chars (≤63). OPTIONAL cross-check via migrate-diff (strip the query string first): `SHADOW="${DBURL%%\?*}_shadow"` then `packages/db/node_modules/.bin/prisma migrate diff --from-migrations packages/db/prisma/migrations --to-schema-datamodel packages/db/prisma/schema.prisma --shadow-database-url "$SHADOW" --script` and diff against the hand-authored SQL.

- [ ] **Step 3:** `pnpm db:generate` then `pnpm db:check-drift` (PG up at localhost:5432). Expected: NO drift (this is the acceptance gate — it proves the hand-authored SQL matches the schema model). If drift, fix the SQL, not the schema.

### Task 3: db store — findDue + markFailed 3-arg

**Files:**

- Modify: `packages/db/src/stores/prisma-robin-recovery-send-store.ts`
- Test: `packages/db/src/stores/__tests__/prisma-robin-recovery-send-store.test.ts`

**Interfaces — Consumes:** the T1 core iface + constants. Mirror `prisma-scheduled-follow-up-store.ts` (findDue/markFailed) and its test.

- [ ] **Step 1 (RED):** In the store test (mocked prisma — `{ robinRecoverySend: { create: vi.fn(), update: vi.fn(), findMany: vi.fn() } }`), add three tests, asserting the EXACT prisma calls:
  - `findDue(now, 100)` → `findMany` called with `where: { status: "pending", nextRetryAt: { lte: now }, attempts: { lt: 3 }, createdAt: { gte: <now - 24h> } }, orderBy: { nextRetryAt: "asc" }, take: 100, select: { id:true, organizationId:true, contactId:true, bookingId:true, campaignKind:true, attempts:true }`.
  - `markFailed("r1","boom", <future Date>)` → `update` with `data: { status:"pending", attempts:{increment:1}, nextRetryAt:<future>, lastError:"boom" }`.
  - `markFailed("r1","boom", null)` → `update` with `data: { status:"failed", attempts:{increment:1}, nextRetryAt:null, lastError:"boom" }`.
    Run `pnpm --filter @switchboard/db test -- prisma-robin-recovery-send-store` → FAIL.
- [ ] **Step 2 (GREEN):** Implement:

```ts
async findDue(now: Date, limit: number): Promise<DueRobinRecoverySend[]> {
  // Retry-cron reclaim: ONLY explicitly-rescheduled rows (nextRetryAt set + due). Fresh cohort rows
  // (nextRetryAt null) belong to the cohort executor, so this DELIBERATELY drops the prior-art
  // `OR nextRetryAt null` leg (avoids a double-send race with the daily cohort cron). lte excludes
  // nulls in SQL, so it is the explicit-reschedule filter. createdAt floor is the MAX_AGE stale guard.
  const minCreatedAt = new Date(now.getTime() - ROBIN_RECOVERY_RETRY_MAX_AGE_MS);
  return this.prisma.robinRecoverySend.findMany({
    where: { status: "pending", nextRetryAt: { lte: now }, attempts: { lt: ROBIN_RECOVERY_MAX_SEND_ATTEMPTS }, createdAt: { gte: minCreatedAt } },
    orderBy: { nextRetryAt: "asc" }, take: limit,
    select: { id: true, organizationId: true, contactId: true, bookingId: true, campaignKind: true, attempts: true },
  });
}
async markFailed(id: string, error: string, nextRetryAt: Date | null): Promise<void> {
  await this.prisma.robinRecoverySend.update({
    where: { id },
    data: nextRetryAt
      ? { status: "pending", attempts: { increment: 1 }, nextRetryAt, lastError: error }
      : { status: "failed", attempts: { increment: 1 }, nextRetryAt: null, lastError: error },
  });
}
```

Import the constants + `DueRobinRecoverySend` from `@switchboard/core`. Run the test → PASS.

- [ ] **Step 3:** `pnpm --filter @switchboard/db exec tsc --noEmit` → PASS. **Commit T1-T3:** `feat(core): bounded-retry state on RobinRecoverySend store + migration (A5b)`.

### Task 4: metric robinRecoverySendFailed (3 factory sites)

**Files:** `packages/core/src/telemetry/metrics.ts`, `apps/api/src/metrics.ts`, `apps/chat/src/bootstrap/metrics.ts`
**Test:** `packages/core/src/telemetry/__tests__/metrics.test.ts` (or co-located)

- [ ] **Step 1 (RED):** Add `it("createInMemoryMetrics exposes robinRecoverySendFailed")` asserting `typeof createInMemoryMetrics().robinRecoverySendFailed.inc === "function"`. Run `pnpm --filter @switchboard/core test -- metrics` → FAIL.
- [ ] **Step 2 (GREEN):** core `metrics.ts`: after `whatsappProactiveSendSkipped: Counter;` add:

```ts
/** A Robin no-show recovery send EXHAUSTED its bounded retries (or hit a terminal config gap at
 *  retry) and dead-lettered (status=failed, nextRetryAt cleared). The never-silent per-recipient
 *  terminal-failure signal; a sustained rate (or the high-ratio cron alert) is a send-path outage.
 *  Labeled by intent + reason (max_retries_exhausted | config_missing | context_resolve_failed). */
robinRecoverySendFailed: Counter;
```

and in `createInMemoryMetrics` after `whatsappProactiveSendSkipped: new InMemoryCounter(),` add `robinRecoverySendFailed: new InMemoryCounter(),`. Run the test → PASS.

- [ ] **Step 3:** `apps/api/src/metrics.ts` after the `whatsappProactiveSendSkipped` PromCounter add:

```ts
    robinRecoverySendFailed: new PromCounter(
      "switchboard_robin_recovery_send_failed_total",
      "Robin recovery sends that exhausted bounded retries and dead-lettered (terminal failed); labeled by intent + reason",
      ["intent", "reason"],
    ),
```

Mirror the identical block in `apps/chat/src/bootstrap/metrics.ts`.

- [ ] **Step 4:** `pnpm --filter @switchboard/core exec tsc --noEmit && pnpm --filter @switchboard/api exec tsc --noEmit && pnpm --filter @switchboard/chat exec tsc --noEmit` → PASS (the typed factories enforce all 3 sites). **Commit:** `feat(core): robinRecoverySendFailed metric across the 3 SwitchboardMetrics factories (A5b)`.

### Task 5: api shared core — robin-recovery-send-core.ts

**Files:** Create `apps/api/src/bootstrap/robin-recovery-send-core.ts` + `__tests__/robin-recovery-send-core.test.ts`

**Interfaces — Produces:**

- `computeRecoveryNextRetry(currentAttempts: number, now: Date, random: () => number): Date | null`
- `dispatchRecoveryRow(args, deps): Promise<{ outcome: "sent"|"skipped"|"failed"; deadLettered: boolean }>` where `args = { rowId; attempts; ctx: RecoverySendContext; eligibility; rebooked: boolean; accessToken; phoneNumberId }` and `deps: DispatchRecoveryRowDeps = { store: RobinRecoverySendStore; sendTemplate; now: () => Date; random: () => number; onDeadLetter?: (reason: string) => void }`.
- `isOrgConfigSkip(eligibility): boolean`; `evaluateRecoveryEligibility(ctx, selectTemplateFn?): ProactiveSendEligibility`; `RECOVERY_INTENT_CLASS`; the moved `RecoverySendContext`, `RecoveryTemplateSendArgs`, `RecoveryTemplateSendResult`, `defaultSendTemplate`.
- TYPE NOTE: `eligibility` is typed `ProactiveSendEligibility` (the discriminated union `{eligible:true; template: WhatsAppTemplate} | {eligible:false; reason: ProactiveSkipReason}`, imported from `@switchboard/core` — NOT `ReturnType<typeof evaluateProactiveSendEligibility>`). After `if (!eligibility.eligible) return …`, TS narrows so `eligibility.template.metaTemplateName` typechecks; `isOrgConfigSkip` reads `eligibility.reason` on the `!eligible` branch.

- [ ] **Step 1 (RED — computeRecoveryNextRetry):** Tests: `attempts=0, random=()=>0.5` → a Date `now + 7.5min` (BASE/2); `attempts=0, random=()=>0` → `now` (immediate, floor 0); `attempts=1, random=()=>1` → `now + ~30min` (within CAP); `attempts=2` (=MAX-1) → `null` (terminal, regardless of random); `attempts=NaN` → `null`. Run `pnpm --filter @switchboard/api test -- robin-recovery-send-core` → FAIL.
- [ ] **Step 2 (GREEN):**

```ts
export function computeRecoveryNextRetry(
  currentAttempts: number,
  now: Date,
  random: () => number,
): Date | null {
  if (!Number.isFinite(currentAttempts) || currentAttempts + 1 >= ROBIN_RECOVERY_MAX_SEND_ATTEMPTS)
    return null;
  const capped = Math.min(
    ROBIN_RECOVERY_RETRY_BASE_MS * 2 ** currentAttempts,
    ROBIN_RECOVERY_RETRY_CAP_MS,
  );
  const jitter = Math.floor(Math.min(1, Math.max(0, random())) * capped); // full jitter [0, capped)
  return new Date(now.getTime() + jitter);
}
```

- [ ] **Step 3 (RED — dispatchRecoveryRow):** Move `RecoverySendContext`/`RecoveryTemplateSendArgs`/`RecoveryTemplateSendResult`/`defaultSendTemplate`/`RECOVERY_INTENT_CLASS` here from the executor (Task 6 updates the executor to import them). Tests with a `store = { create: vi.fn(), markSent: vi.fn(), markSkipped: vi.fn(), markFailed: vi.fn(), findDue: vi.fn() }`:
  - `rebooked:true` → `markSkipped(rowId,"already_rebooked")`, `sendTemplate` NOT called, returns `{outcome:"skipped",deadLettered:false}`.
  - ineligible (`{eligible:false,reason:"consent_revoked"}`) → `markSkipped(rowId,"consent_revoked")`, no send.
  - `ctx.phone=null`, eligible → `markSkipped(rowId,"missing_contact_phone")`.
  - eligible + `sendTemplate→{ok:true,messageId:"m1"}` → `markSent(rowId,"m1")`, returns sent.
  - eligible + `sendTemplate→{ok:false,error:"500"}`, `attempts=0` → `markFailed(rowId,"500",<non-null>)`, `onDeadLetter` NOT called, returns `{outcome:"failed",deadLettered:false}`.
  - eligible + `sendTemplate→{ok:false}`, `attempts=2` → `markFailed(rowId,_,null)`, `onDeadLetter("max_retries_exhausted")` called, `deadLettered:true`.
  - eligible + `sendTemplate` throws → `markFailed(rowId,<msg>,<computed>)`.
    Run → FAIL.
- [ ] **Step 4 (GREEN):** Implement `dispatchRecoveryRow` (rebooked→eligibility→phone→send→mark; a private `finishFailed` computes `computeRecoveryNextRetry(attempts, deps.now(), deps.random)`, calls `markFailed`, and on null fires `onDeadLetter`), `isOrgConfigSkip`, `evaluateRecoveryEligibility`. Code in the FRAME ledger. Run → PASS.
- [ ] **Step 5:** `pnpm --filter @switchboard/api exec tsc --noEmit` (will RED until Task 6 removes the duplicate type/helper defs from the executor — sequence T5→T6 then commit together).

### Task 6: cohort executor refactor (uses dispatchRecoveryRow; markFailed schedules retry)

**Files:** Modify `apps/api/src/bootstrap/robin-recovery-executor.ts` + its test.

- [ ] **Step 1 (RED):** The cohort send-failure now schedules retry-1, so BOTH existing 2-arg positive `markFailed` assertions must flip to 3-arg (grade: "fixed in N, missed in N+1"). Update **both**:
  - `robin-recovery-executor.test.ts:245` (the "Graph send failure" / `!ok` path): `markFailed("rs_1", "rate limited")` → `markFailed("rs_1", "rate limited", expect.any(Date))`.
  - `robin-recovery-executor.test.ts:291` (the "network rejection" / thrown path): `markFailed("rs_1", "ECONNRESET")` → `markFailed("rs_1", "ECONNRESET", expect.any(Date))`.
    (Both are non-null — attempts 0 never dead-letters at MAX=3; both route through `dispatchRecoveryRow`'s `finishFailed`.) The `not.toHaveBeenCalled()` assertions stay as-is. Add `it("a cohort send failure leaves the row pending for retry, not terminal")` asserting the 3rd arg is a Date (not null). Run `pnpm --filter @switchboard/api test -- robin-recovery-executor` → FAIL (still 2-arg at both sites).
- [ ] **Step 2 (GREEN):** Refactor `buildRobinRecoverySendExecutor`: import `dispatchRecoveryRow`, `evaluateRecoveryEligibility`, `isOrgConfigSkip`, the moved types + `defaultSendTemplate` from `./robin-recovery-send-core.js`; delete the now-moved local defs. Per-recipient loop becomes: `getSendContext` (pre-claim, unchanged) → `const eligibility = evaluateRecoveryEligibility(ctx, deps.selectTemplateFn)` → `if (isOrgConfigSkip(eligibility)) { skipped++; continue; }` (rank-7 pre-claim) → claim (unchanged, P2002→skip) → `const r = await dispatchRecoveryRow({ rowId, attempts: 0, ctx, eligibility, rebooked: rebookedContactIds.has(candidate.contactId), accessToken, phoneNumberId }, { store: deps.store, sendTemplate, now: () => now, random, onDeadLetter: undefined })` → tally `r.outcome`. Add `random?: () => number` to the executor deps (default `Math.random`). The rebooked/eligibility/phone/send/markFailed/markSent blocks are now INSIDE dispatchRecoveryRow (removed from the loop). Run the executor test (all A5a tests: draft→0 claims, rebooked→already_rebooked, approved→send, plus the updated send-fail) → PASS.
- [ ] **Step 3:** `pnpm --filter @switchboard/api exec tsc --noEmit` → PASS. **Commit T5-T6:** `refactor(api): extract dispatchRecoveryRow; cohort send-failure schedules a retry (A5b)`.

### Task 7: retry executor — buildRobinRecoverySendRetryExecutor

**Files:** Modify `apps/api/src/bootstrap/robin-recovery-executor.ts` + test. **Consumes:** `ROBIN_RECOVERY_RETRY_INTENT` (Task 8 — define it first as a bare const if needed, or sequence T8 before T7's GREEN).

**Interfaces — Produces:** `buildRobinRecoverySendRetryExecutor(deps): { intent: string; handler: WorkflowHandler }` where deps = cohort deps minus the cohort-only fields plus `findFutureBookingContactIds?`, `now?`, `random?`. Outputs shape: `{ outcome: "sent"|"skipped"|"failed"; deadLettered: boolean }`.

- [ ] **Step 1 (RED):** Tests with mocked `store` (incl. `markSent/markSkipped/markFailed/create`), `getSendContext`, `sendTemplate`, `findFutureBookingContactIds`, fixed `now`, `random:()=>0.5`, and a `setMetrics(createInMemoryMetrics())` to read the counter:
  - **single-row reclaim:** any path → `store.create` NEVER called (the row exists).
  - **success:** eligible ctx + `sendTemplate ok` → `markSent`, outputs `{outcome:"sent",deadLettered:false}`.
  - **retry-below-cap:** eligible + `sendTemplate {ok:false}`, params `attempts:1` → `markFailed(rowId,_,<non-null>)`, outputs `deadLettered:false`.
  - **terminal-at-cap (+metric):** params `attempts:2` + `sendTemplate {ok:false}` → `markFailed(rowId,_,null)` AND `getMetrics().robinRecoverySendFailed` incremented, outputs `deadLettered:true`.
  - **consent re-validation:** `getSendContext` returns `consentRevokedAt` set → `markSkipped(rowId,"consent_revoked")`, NO send (re-validated at retry).
  - **template re-validation:** `approvalOverlay` makes template unapproved → `markSkipped(rowId,"template_not_approved")`, NO send.
  - **rebooked re-check:** `findFutureBookingContactIds` returns the contact → `markSkipped(rowId,"already_rebooked")`, NO send.
  - **config_missing:** no creds → `markFailed(rowId,"config_missing",<computed>)` (+metric iff terminal).
  - **malformed params:** `workUnit.parameters={}` → `outcome:"failed"` result, store untouched.
    Run `pnpm --filter @switchboard/api test -- robin-recovery-executor` → FAIL.
- [ ] **Step 2 (GREEN):** Implement `buildRobinRecoverySendRetryExecutor` (code sketch in the FRAME ledger): `RobinRecoveryRetryParamsSchema.safeParse` → creds (single org; missing → markFailed transient + metric-if-terminal) → `getSendContext` (throw → markFailed transient + metric-if-terminal, reason `context_resolve_failed`) → `evaluateRecoveryEligibility` → `isOrgConfigSkip` → terminal `markSkipped(reason)` → rebooked single-contact check → `dispatchRecoveryRow({ rowId, attempts, ctx, eligibility, rebooked, accessToken, phoneNumberId }, { store, sendTemplate, now: () => now, random, onDeadLetter: (reason) => getMetrics().robinRecoverySendFailed.inc({ intent: ROBIN_RECOVERY_RETRY_INTENT, reason }) })`. Return `{ outcome: "completed", summary, outputs: { outcome: r.outcome, deadLettered: r.deadLettered } }`. Run → PASS.
- [ ] **Step 3:** `pnpm --filter @switchboard/api exec tsc --noEmit` → PASS. **Commit:** `feat(api): single-recipient recovery retry executor (re-validates consent+template) (A5b)`.

### Task 8: request builder + platform-direct resolver

**Files:** Modify `apps/api/src/services/workflows/robin-recovery-request.ts`; `apps/api/src/bootstrap/platform-deployment-resolver.ts` + test.

- [ ] **Step 1 (RED — builder + seam):** In a request test: `buildRecoveryRetrySubmitRequest({organizationId:"o1",rowId:"r1",contactId:"c1",bookingId:"b1",campaignKind:"no_show",attempts:1})` → `actor` deep-equals `{id:"system",type:"system"}`, `intent==="robin.recovery_send.retry"`, `trigger==="schedule"`, `idempotencyKey==="mutate:robin:o1:retry:r1:1"`, and the **producer→consumer seam**: `RobinRecoveryRetryParamsSchema.safeParse(req.parameters).success === true`. Run → FAIL.
- [ ] **Step 2 (GREEN):** Add `ROBIN_RECOVERY_RETRY_INTENT = "robin.recovery_send.retry"`, `RecoveryRetrySubmitInput`, `buildRecoveryRetrySubmitRequest` (code in FRAME ledger). Run → PASS.
- [ ] **Step 3 (RED — resolver):** In `platform-deployment-resolver.test.ts`, mirror the `:168` test: `it("resolves robin.recovery_send.retry to platform-direct")` asserting `resolve({intent:"robin.recovery_send.retry",...})` → `deploymentId:"platform-direct", skillSlug:"robin"`. Run → FAIL.
- [ ] **Step 4 (GREEN):** Import `ROBIN_RECOVERY_RETRY_INTENT` and add the literal to the `PLATFORM_DIRECT_WORKFLOW_INTENTS` **Set initializer array** at line 47 (next to `ROBIN_RECOVERY_SEND_INTENT`) — NOT via `.add()` (the const is typed `ReadonlySet<string>`, which has no `.add`). Update the set's doc comment to mention the retry (a single 1:1 re-send, allow-only gated). Run → PASS.
- [ ] **Step 5:** `pnpm --filter @switchboard/api exec tsc --noEmit`. **Commit:** `feat(api): retry submit-request (seeded system) + platform-direct resolve (A5b)`.

### Task 9: retry cron — robin-recovery-retry-dispatch.ts

**Files:** Create `apps/api/src/services/cron/robin-recovery-retry-dispatch.ts` + test.

**Interfaces — Produces:** `executeRobinRecoveryRetryDispatch(step, deps)`, `createRobinRecoveryRetryDispatchCron(deps)`, `RobinRecoveryRetryDispatchDeps = { failure: AsyncFailureContext; findDueRetries: (now, limit) => Promise<DueRobinRecoverySend[]>; submitRecoveryRetry: (input: RecoveryRetrySubmitInput) => Promise<SubmitWorkResponse>; now? }`.

- [ ] **Step 1 (RED):** Tests with `step = { run: async (_n, fn) => fn() }`, a `deps` factory (mirror robin-recovery-dispatch.test.ts + scheduled-follow-up-dispatch.test.ts), and a spy `operatorAlerter`:
  - per-row submit: `findDueRetries`→2 rows → `submitRecoveryRetry` called twice with the row fields.
  - tally: submit `{ok:true,result:{outputs:{outcome:"sent"}}}` → `sent`; `{outputs:{outcome:"failed",deadLettered:true}}` → `failed`+`deadLettered`.
  - **high-ratio alert fires:** 3 due, 2 deadLettered → `operatorAlerter.alert` called once with `errorType:"async_job_retry_exhausted", severity:"warning"`.
  - **low-ratio no alert:** 1 due, 1 deadLettered (below MIN=3) → alert NOT called.
  - `idempotency_in_flight` → counted skipped, not failed.
  - **defensive park:** `{ok:true,approvalRequired:true}` → counted skipped, NOT a phantom-sent (proves the retry must auto-execute; a park is a misconfig, never a silent success).
    Run → FAIL.
- [ ] **Step 2 (GREEN):** Implement per the FRAME ledger sketch: per-row `step.run("recovery-retry-${row.id}")`; NaN-safe ratio guard `deadLettered > 0 && due.length >= DEAD_LETTER_ALERT_MIN && deadLettered / due.length >= DEAD_LETTER_ALERT_RATIO`; cron id `robin-recovery-retry-dispatch`, `cron "*/15 * * * *"`, `retries:2`, `makeOnFailureHandler(...alert:true)`. The alert payload is the FULL `InfrastructureFailureAlert` (all fields typecheck-enforced):

```ts
await safeAlert(deps.failure.operatorAlerter, {
  errorType: "async_job_retry_exhausted",
  severity: "warning", // valid: "critical" | "warning"
  errorMessage: `${deadLettered}/${due.length} Robin recovery sends dead-lettered after exhausting bounded retries`,
  intent: ROBIN_RECOVERY_RETRY_INTENT,
  retryable: false,
  occurredAt: now.toISOString(),
  source: "inngest_function",
});
```

Run → PASS.

- [ ] **Step 3:** `pnpm --filter @switchboard/api exec tsc --noEmit`. **Commit T8-T9:** include the cron. `feat(api): */15 recovery retry cron — findDue, per-row ingress submit, dead-letter ratio alert (A5b)`.

### Task 10: governance — allow-only retry policy + real-gate proof

**Files:** Modify `packages/db/src/seed/robin-recovery-governance.ts` + its test; the apps/api real-gate test that shares it.

- [ ] **Step 1 (RED):** In `seed-robin-recovery-governance.test.ts`: `it("retry allow policy is allow-only, anchored to the retry intent")` → `buildRobinRecoveryRetryAllowPolicyInput("o1")` has `effect:"allow"`, `rule.conditions[0].value === "^robin\\.recovery_send\\.retry$"`, and NO `approvalRequirement`. Add `it("seedRobinRecoveryPolicies upserts THREE policies")` (cohort-allow + cohort-approval + retry-allow). Run `pnpm --filter @switchboard/db test -- robin-recovery-governance` → FAIL.
- [ ] **Step 2 (GREEN):** Add `ROBIN_RECOVERY_RETRY_POLICY_RULE`, `robinRecoveryRetryAllowPolicyId`, `buildRobinRecoveryRetryAllowPolicyInput` (allow, priority 50, anchored to `^robin\\.recovery_send\\.retry$`); extend `seedRobinRecoveryPolicies` to upsert the third policy; add a third bullet to the file's top doc comment ("3. allow-only retry policy — the bounded-retry re-send of an ALREADY-APPROVED campaign send auto-executes; consent + template re-validated in the executor. Mirrors proactive-intake-governance."). Run → PASS.
- [ ] **Step 3 (real-gate unit seam):** Export `buildRobinRecoveryRetryAllowPolicyInput` from the db barrel (`packages/db/src/index.ts:226-231`, alongside `buildRobinRecoveryAllowPolicyInput`). In `apps/api/src/__tests__/robin-recovery-gate.test.ts` (the REAL `GovernanceGate.evaluate` harness — NOT `seedRobinRecoveryPolicies`, which no apps/api test imports), add a `retryAllowPolicy()` (mirror `allowPolicy()` at :53 but with `buildRobinRecoveryRetryAllowPolicyInput`), build a retry work unit + `IntentRegistration` (mirror the cohort `recoveryRegistration`, `approvalPolicy:"none"`), and assert: the retry intent EXECUTES with allow-ONLY seeded (no `require_approval` partner, NO park), while the cohort still parks with allow+approval. Run `pnpm --filter @switchboard/api test -- robin-recovery-gate` → PASS.
- [ ] **Step 4 (e2e auto-execute through REAL ingress — the strongest acceptance proof):** In `apps/api/src/__tests__/robin-recovery-cron-live-path.test.ts` (drives `buildRecovery*SubmitRequest` → REAL `PlatformIngress.submit` → REAL `GovernanceGate` → REAL platform-direct carve-out resolver; today it proves the cohort PARKS), add the INVERSE for the retry: register a placeholder handler for `ROBIN_RECOVERY_RETRY_INTENT` in the test ingress's handlers map (mirror the `ROBIN_RECOVERY_SEND_INTENT` placeholder at :187), seed ONLY the retry allow policy, submit `buildRecoveryRetrySubmitRequest(...)`, and assert the result EXECUTES (`res.ok && !("approvalRequired" in res)`), NOT parked. This proves the auto-execute acceptance criterion through the same real submit stack that proves the cohort parks (depends on Task 8's resolver carve-out). Run `pnpm --filter @switchboard/api test -- robin-recovery-cron-live-path` → PASS.
- [ ] **Step 5:** `pnpm --filter @switchboard/db exec tsc --noEmit && pnpm --filter @switchboard/api exec tsc --noEmit`. **Commit:** `feat(db): allow-only governance for the auto-executing recovery retry (A5b)`.

### Task 11: wiring — register handler/intent + the live retry cron (producer population)

**Files:** Modify `apps/api/src/bootstrap/contained-workflows.ts`, `apps/api/src/app.ts`, `apps/api/src/bootstrap/inngest.ts`.

> This is the producer-population task: without it the migration columns + retry executor are inert. The fan-out grade + VERIFY must confirm the cron is in the Inngest function list and its deps resolve.

- [ ] **Step 1:** `contained-workflows.ts`: (a) extract the cohort's inline `getSendContext` closure to a shared `const getRecoverySendContext = async (orgId, contactId) => {...}` (the existing `buildWhatsAppSendContext` body) and pass it to BOTH the cohort and the new retry executor; (b) `const robinRecoverySendRetryExecutor = buildRobinRecoverySendRetryExecutor({ store: robinRecoverySendStore, getSendContext: getRecoverySendContext, resolveOrgSendCreds: resolveOrgWhatsAppSend, findFutureBookingContactIds: (o,c,n) => robinRecoveryBookingStore.findFutureBookingContactIds(o,c,n) })`; (c) add `[robinRecoverySendRetryExecutor.intent, robinRecoverySendRetryExecutor.handler]` to the handlers map (near the cohort handler); (d) add a `workflowIntents` entry `{ intent: robinRecoverySendRetryExecutor.intent, workflowId: robinRecoverySendRetryExecutor.intent, budgetClass: "cheap", approvalPolicy: "none", allowedTriggers: ["schedule"] }` with a comment mirroring the cohort entry's: `approvalPolicy` is DECORATIVE (the policy engine reads the seeded policy, not this field); the auto-execute guarantee is the seeded allow-only retry policy (Task 10) + platform-direct resolution (Task 8); consent + template are re-validated in-executor at retry time; (e) build `submitRecoveryRetry = (input: RecoveryRetrySubmitInput) => platformIngress.submit(buildRecoveryRetrySubmitRequest(input))` and add it to the bootstrap return object.
- [ ] **Step 2:** `app.ts`: add `let submitRecoveryRetry: ((input: ...RecoveryRetrySubmitInput) => Promise<...SubmitWorkResponse>) | undefined;`, capture `submitRecoveryRetry = result.submitRecoveryRetry;`, and add `submitRecoveryRetry` to the inngest-bootstrap options object (near the `submitRecoveryCampaign,` at ~1194).
- [ ] **Step 3:** `inngest.ts`: (a) add `submitRecoveryRetry?: (input: RecoveryRetrySubmitInput) => Promise<SubmitWorkResponse>;` to the options interface (near line 212); (b) `const robinRecoverySendStore = new PrismaRobinRecoverySendStore(app.prisma!);` (mirror `bookingStore:971`); (c) `const robinRecoveryRetryDispatchDeps: RobinRecoveryRetryDispatchDeps = { failure: asyncFailure, findDueRetries: (now, limit) => robinRecoverySendStore.findDue(now, limit), submitRecoveryRetry: (input) => { if (!options.submitRecoveryRetry) throw new Error("submitRecoveryRetry not wired"); return options.submitRecoveryRetry(input); } };`; (d) register `createRobinRecoveryRetryDispatchCron(robinRecoveryRetryDispatchDeps),` in the Inngest function list next to `createRobinRecoveryDispatchCron` (line ~1461).
- [ ] **Step 4 (RED→GREEN wiring test):** Add/extend an inngest-bootstrap or contained-workflows test asserting the retry intent handler is registered (the handlers map / intentRegistry contains `robin.recovery_send.retry`) and (if a function-list test exists) that `robin-recovery-retry-dispatch` is among the registered Inngest functions. If no such harness exists, assert via `bootstrapContainedWorkflows(...).submitRecoveryRetry` is a function. Run `pnpm --filter @switchboard/api test` (relevant suite) → PASS.
- [ ] **Step 5:** `pnpm --filter @switchboard/api exec tsc --noEmit` + `pnpm --filter @switchboard/api build` (the api build type-checks tests too) → PASS. **Commit:** `feat(api): wire the live recovery retry cron + handler registration (A5b)`.

---

## VERIFY (build-loop phase 4 — delegated gate-run + independent review)

Gates (a verifier subagent runs them, returns per-gate pass/fail + only the failing excerpt): `pnpm typecheck`; `pnpm test`; `pnpm --filter @switchboard/api test`; `pnpm --filter @switchboard/db test`; `pnpm lint`; `pnpm format:check`; `pnpm arch:check`; `CI=1 npx tsx scripts/local-verify-fast.ts` (route/env allowlist — a cron is NOT an HTTP route, expect no new entry needed; confirm); `pnpm build` (api + chat changed); `pnpm db:check-drift`; `pnpm audit --audit-level=high`. NO eval (send path, not the decision engine). Three-dot diff `git diff origin/main...HEAD` vs each acceptance criterion. Then an INDEPENDENT fresh-context review (diff + acceptance + lessons only).

## Self-Review (spec coverage)

- transient reclaim to N then dead-letter → T3 (store), T5 (computeNextRetry/dispatch), T7 (retry terminal+metric), T9 (cron). ✓
- terminal outcomes stay permanent (sent/consent/no-phone/rebooked/draft-template) → T5/T6 (markSkipped paths), T7 (re-validation). ✓
- retry re-validates consent + template → T7 (consent/template re-validation tests). ✓
- retry through PlatformIngress, seeded system → T8 (builder), T11 (submit closure). ✓
- new intent auto-executes, not parks → T8 (resolver), T10 (allow-only gov + real-gate). ✓
- migration db:check-drift green → T2. ✓
- single-row reclaim, no new dedup row → T7 (store.create never called). ✓
- producer population (cron live) → T11. ✓
- per-recipient metric + high-ratio alert, never silent → T4, T7, T9. ✓
- all store mocks updated (3 sites) → T3 (prisma test), T6 (executor test makeStore), and `robin-recovery-approval-loop.test.ts` in-memory store (update its `markFailed` to 3-arg + add `findDue` in T6's commit). ✓
