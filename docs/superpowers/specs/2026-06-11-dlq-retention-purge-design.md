# F6 — Dead-letter-queue retention purge (PDPA) — Design

**Audit:** `docs/audits/2026-06-10-security-audit/07-pii-and-pdpa.md` (F6) and `11-tickets.md` → F6.
**Finding:** HIGH (compounds F5). The DLQ store `apps/chat/src/dlq/failed-message-store.ts` writes the entire inbound webhook (`rawPayload` = patient message text + phone) verbatim. Its only "cleanup" — `sweepExhausted` (`:94-112`) — flips a status flag and **never deletes**. There is no TTL, no `expiresAt`, no purge cron. Every webhook that ever failed to parse keeps a patient's PII forever — a PDPA retention-limitation breach.

**Scope:** F6 only. No other audit finding is folded in.

**Completes the F5/F6 retention+deletion pair.** F5 (PR #971, branch `fix/contact-erasure-pdpa`, commit `8002a2fa`, currently an **open PR not yet on `main`**) deletes a *single contact's* DLQ rows on right-to-erasure. Its `prisma-contact-store.ts` comment says DLQ "growth is bounded separately by the F6 retention purge." This change delivers that bound: a scheduled, time-based, cross-tenant purge. The two are complementary (per-subject erasure vs. global time-based retention) and do not overlap in code.

---

## Decisions (resolved during brainstorm; no open questions)

### 1. Retention windows
Two windows, both env-configurable:

- **Soft window — `DLQ_RETENTION_DAYS` (default 30).** Rows with `status IN ('resolved','exhausted')` older than this are deleted. Once a row is resolved (a human handled it) or exhausted (max retries hit, no longer actionable), it has served its operational purpose; 30 days gives ops a comfortable review window while bounding PII.
- **Hard cap — `DLQ_HARD_RETENTION_DAYS` (default 90).** Rows of **any** status (including stuck `pending`) older than this are deleted unconditionally. This guarantees PII cannot live forever even if a row never reaches a terminal status (e.g. a `pending` row that is never retried or swept). 90 days is the absolute PDPA retention ceiling for this data class.

A row is purged when:
`(status IN ('resolved','exhausted') AND createdAt < softCutoff) OR (createdAt < hardCutoff)`

Defaults chosen so the hard cap is strictly looser than the soft window (90 > 30); the soft window does the routine work and the hard cap is the backstop for non-terminal rows.

### 2. Where the delete lives
The batched `deleteMany` lives in **`packages/db`** as a new `PrismaFailedMessageRetentionStore.purgeExpired(...)` method, called by a new **`apps/api`** Inngest cron.

Rationale:
- The `FailedMessage` model is owned by `packages/db` (shared by apps/chat producer + this consumer). apps/api **cannot** import from apps/chat (sibling apps; not a dependency edge), so co-locating the delete on the apps/chat `FailedMessageStore` is not reachable from a cron.
- Putting the `deleteMany` in a db store keeps it unit-testable with mocked Prisma (the established `packages/db/src/stores/__tests__` pattern), exactly mirroring the precedent `PrismaAggregateMemoryStore.decayStale` — a daily, cron-triggered, intentionally cross-tenant mutation in a db store.
- The cron stays a thin orchestrator (compute cutoffs from env + now, call the store inside `step.run`, emit metrics, carry the failure contract), mirroring `meta-token-refresh.ts` / `lifecycle-stalled-sweep.ts`.

### 3. Schema change — none
Purge by `createdAt < cutoff`. No `expiresAt` column, no migration.
- `createdAt` is already `@@index`ed; the hard-cap range scan uses it directly.
- The DLQ is intentionally a **low-volume** table (only *failed* webhooks, and now bounded by this very purge). A composite `[status, createdAt]` index was considered and **rejected**: it adds write-amplification on every DLQ insert and migration surface for negligible benefit on a small table whose hot query is already createdAt-ordered. If volume ever proves this wrong, the index is a trivial follow-up. Lowest-risk path, and the one the audit/ticket prefer ("Consider an `expiresAt` column" is explicitly optional).

### 4. Batching
Yes. A single unbounded `deleteMany` could hold locks on a large table. The store method runs a **cursor loop**: select up to `batchSize` (default **1000**) eligible ids ordered by `createdAt asc`, `deleteMany WHERE id IN (...)`, repeat until a batch deletes `0` rows. The loop terminates because each delete removes the rows the next select would return. A `maxBatches` guard (default **100** → 100k rows/run) backstops a runaway; if a backlog exceeds that, the next daily run continues. When `maxBatches` is hit with rows still remaining, the cron logs the truncation (no silent cap).

### 5. Observability
The store returns the total purged count. The cron returns `{ purged, batches, truncated }` and logs a one-line summary via the injected logger (mirroring `creative-attribution`'s `logger: app.log`). No `console.log` (lint).

### 6. Schedule + governance
- Inngest cron trigger `0 4 * * *` (daily 04:00 UTC) — its own slot, just after `meta-token-refresh` (03:00) and clear of the 07:00 ad-optimizer cluster.
- Class-low failure contract via `makeOnFailureHandler` (`riskCategory: "low"`, `alert: false`, `emitEvent: false`) — the next daily run self-heals and a `*.failed` domain event would have zero consumers.
- **No PlatformIngress / seeded-system-principal.** This is a pure DB retention purge — it does not submit governed work, so the cron-submit governance rule does not apply (confirmed: the analogous `decayStale` / `lifecycle-stalled-sweep` purge/sweep crons also write Prisma directly without ingress).
- **Store-mutation gate:** the `deleteMany` is intentionally non-org-scoped (retention is global across all tenants), so the method carries `// route-governance: store-mutation-global` with a one-line justification, matching `decayStale`. The gate does not scan apps/api or apps/chat, so only the db-store delete needs the annotation.

---

## Components

| Unit | Responsibility | Depends on |
| --- | --- | --- |
| `PrismaFailedMessageRetentionStore` (`packages/db/src/stores/prisma-failed-message-retention-store.ts`) | `purgeExpired({ softCutoff, hardCutoff, softStatuses, batchSize, maxBatches })` → `{ purged, batches, truncated }`. Owns the OR predicate + batched cursor loop + the `store-mutation-global` delete. | Prisma `FailedMessage` |
| `dlq-retention-purge.ts` cron (`apps/api/src/services/cron/`) | `executeDlqRetentionPurge(step, deps)` computes cutoffs from `now` + config; `createDlqRetentionPurgeCron(deps)` wires the Inngest function (trigger, retries, onFailure). | the store (injected), `AsyncFailureContext`, logger |
| `inngest.ts` wiring | Construct the store, build deps (read env windows with safe numeric parsing), register the cron in the `functions[]` array. | both above |
| env-allowlist + `.env.example` | `DLQ_RETENTION_DAYS`, `DLQ_HARD_RETENTION_DAYS` added to `required_in_env_example` and documented in `.env.example`. | — |

## Data flow
Inngest fires `0 4 * * *` → cron reads `DLQ_RETENTION_DAYS`/`DLQ_HARD_RETENTION_DAYS` (NaN-guarded → defaults), computes `softCutoff = now - softDays`, `hardCutoff = now - hardDays` → `step.run("purge-expired-dlq", () => store.purgeExpired(...))` → store loops batched `deleteMany` → cron logs `{ purged, batches, truncated }`.

## Error handling
- Env windows parsed with `Number.isFinite` guard (per the NaN-blind-comparison gotcha); non-numeric / absent → defaults. Guard against `hardDays < softDays` misconfiguration by taking `max(softDays, hardDays)` for the hard cap so the hard cap can never be tighter than the soft window.
- Store delete failure → propagates → Inngest retry (2) → onFailure audit (no alert).
- maxBatches reached with remainder → `truncated: true`, logged; next run continues.

## Testing (TDD — failing tests first)
**`packages/db` (mocked Prisma):**
- old `resolved`/`exhausted` rows selected for delete; recent ones kept.
- `pending` row younger than hard cap kept; older than hard cap deleted (hard-cap path).
- WHERE predicate shape asserted (OR of soft-status+softCutoff and hardCutoff).
- batch loop terminates (two full batches then empty → stops; returns summed count).
- `maxBatches` halts the loop and sets `truncated`.
- delete is by `id IN (...)` from the selected batch (no cross-tenant id leakage — only selected ids deleted).

**`apps/api` cron (fake step + mocked store):**
- cutoffs computed from injected `now` and env windows; NaN/absent env → defaults; `hardDays` floored to `≥ softDays`.
- store called once inside `step.run`; returns/logs the count.
- `createDlqRetentionPurgeCron` registers a function with the `0 4 * * *` trigger and an onFailure handler.

## Gates before PR
`pnpm --filter @switchboard/db test` · `pnpm --filter @switchboard/api test` · `pnpm typecheck` · `pnpm arch:check` · `pnpm format:check`. (apps/chat is **not** touched, so its suite is not required — confirm no apps/chat edit before skipping.)
