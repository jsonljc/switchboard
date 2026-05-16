# WorkTrace Terminal Locking — Design

**Branch slug:** `fix/launch-work-trace-terminal-lock`
**Effort:** M (3–4h)
**Source:** `.audit/08-launch-blocker-sequence.md` entry #19, scope-reduced for beta launch.

## Why now (and why this slice, not full #19)

`.audit/08-launch-blocker-sequence.md` entry #19 calls for full tamper-evident `WorkTrace` integrity (hash chain or append-only ledger pattern). For the beta launch, that is the wrong scope — too heavy, and the actual risk we need to close is **accidental or careless mutation of completed traces by app code**, not regulator-grade cryptographic proof.

This spec implements the minimum invariant the platform owes its beta users:

> Once a `WorkTrace` reaches terminal state, the audit trail of what happened cannot be silently rewritten by app code.

Full tamper-evidence (hash chains, append-only revisions, storage triggers, cryptographic read verification, tamper-evidence UI) is **explicitly deferred** to a post-beta P1 enterprise-trust hardening project.

## Goals

- Enforce a single, store-level invariant: terminal `WorkTrace`s cannot have core audit fields rewritten.
- Codify the implicit lifecycle transitions as an explicit allowed-transitions table (no parallel state machine — reuse existing status names).
- Hybrid failure mode: throw loudly in dev/test/CI, return a typed conflict result in production.
- Reuse the #17 `OperatorAlerter` for operator visibility on lock violations.
- Schema migration with safe backfill for existing terminal rows.

## Non-Goals (deferred, do not implement)

- Hash chain on `WorkTrace`.
- Append-only revision table.
- Storage-layer triggers (DB-side mutation prevention).
- Cryptographic verification on read.
- Tamper-evidence UI / dashboard surfaces.
- Historical hash backfill.

## Audit findings (current state)

- `WorkTrace` interface lives at `packages/core/src/platform/work-trace.ts`. No `lockedAt` field today.
- `WorkOutcome = "completed" | "failed" | "pending_approval" | "queued" | "running"` (`packages/core/src/platform/types.ts:5`). Terminal = `completed | failed`.
- Three orthogonal status dimensions exist: `outcome`, `governanceOutcome`, `approvalOutcome`. Only `outcome` participates in lock determination.
- `WorkTraceStore.update(workUnitId, Partial<WorkTrace>)` is the **single** update entry point (`packages/core/src/platform/work-trace-recorder.ts:19`).
- Three call sites in `packages/core/src/platform/platform-lifecycle.ts`:
  - `:360` — terminal write after execution (`outcome`, `executionOutputs`, `error`, `completedAt`, `durationMs`).
  - `:537` — `updateWorkTraceFields` for approval response (`approvalId`, `approvalOutcome`, sometimes `outcome`, sometimes `parameters` for patched approvals).
  - `:544` — `updateWorkTraceOutcome` for outcome-only updates.
- `PrismaWorkTraceStore.update` (`packages/db/src/stores/prisma-work-trace-store.ts:139`) is a bare `prisma.workTrace.update` with no read-modify-write or validation. **This is the chokepoint to enforce the invariant.**
- No explicit state machine exists — transitions are implicit in the lifecycle code.

## Design

### 1. Allowed `outcome` transitions

Codify the implicit lifecycle:

```
pending_approval → queued | running | completed | failed
queued           → running | completed | failed
running          → completed | failed
completed        → ∅  (terminal — locked)
failed           → ∅  (terminal — locked)
```

Same-state writes (`pending_approval → pending_approval`, etc.) are allowed for non-`outcome` updates (e.g. setting `approvalId` while still pending).

Any `outcome` change not in the table is rejected.

### 2. Field-protection categories

Four buckets:

**A. Always-immutable (no mutation ever after first persist):**

- Identifiers and provenance: `workUnitId`, `traceId`, `organizationId`, `actor`, `intent`, `mode`, `trigger`, `deploymentContext`, `deploymentId`.
- Governance evidence: `governanceOutcome`, `governanceConstraints`, `riskScore`, `matchedPolicies`.
- Timestamps and identity: `requestedAt`, `governanceCompletedAt`, `idempotencyKey`.

**B. Mutable until approval resolves OR execution starts (whichever comes first):**

- `parameters`.
- This loosening exists to support the `approvalOutcome: "patched"` flow, where an approver edits parameters before execution. Once `approvalOutcome` is non-null OR `executionStartedAt` is set OR `lockedAt` is set, `parameters` is sealed.

**C. One-shot lifecycle fields (settable exactly once, then immutable):**

- Approval block: `approvalId`, `approvalOutcome`, `approvalRespondedBy`, `approvalRespondedAt`. Set together by the approval response handler; cannot be overwritten.
- `executionStartedAt` (set once when execution begins).

**D. Terminal-only fields (set as part of the terminal write; immutable after `lockedAt`):**

- `executionOutputs`, `executionSummary`, `error`, `completedAt`, `durationMs`.

**E. Always-allowed up to lock:**

- `modeMetrics`. Free to update during execution; sealed at lock.

### 3. `lockedAt` semantics

- New nullable column on the `workTrace` Prisma model: `lockedAt: DateTime?`.
- `lockedAt` is set **automatically** by the store when an `update()` transitions `outcome` into a terminal value (`completed` or `failed`). The caller does not pass `lockedAt`.
- Once `lockedAt` is non-null, **all** further `update()` calls fail per category D/A/etc. The store rejects them.
- `lockedAt` is exposed on the `WorkTrace` interface (read-only contract — no caller should ever write to it).

### 4. Store contract change (breaking)

`WorkTraceStore.update()` currently returns `Promise<void>`. New signature:

```ts
export type WorkTraceUpdateResult =
  | { ok: true; trace: WorkTrace }
  | { ok: false; code: "WORK_TRACE_LOCKED"; traceUnchanged: true; reason: string };

export interface WorkTraceStore {
  // … existing methods …
  update(workUnitId: string, fields: Partial<WorkTrace>): Promise<WorkTraceUpdateResult>;
}
```

The external `reason` is a single human-readable sentence (e.g. `"Trace locked at 2026-04-28T13:50:49Z; field 'outcome' cannot be modified"`). It deliberately does not enumerate rejected field names or expose old/new values — the typed result stays small for now (UX surfacing is a future concern).

The richer diagnostic payload — `traceId`, `workUnitId`, `currentOutcome`, `lockedAt`, `rejectedFields[]`, `caller` — is included in the **internal** audit/alert payload, not the public typed result.

All three call sites in `platform-lifecycle.ts` MUST handle the conflict result. They cannot ignore it.

### 5. Failure mode (Hybrid C)

The store's update method behaves environment-dependently when validation fails:

- `process.env.NODE_ENV !== "production"` → throw a typed `WorkTraceLockedError` with the same `reason` and the rich diagnostic payload attached. This catches programmer errors loudly in dev/test/CI.
- `process.env.NODE_ENV === "production"` → return the typed conflict result. The locked trace remains unchanged. The store also:
  1. Writes an infrastructure-failure audit entry via the #17 builder (`errorType: "work_trace_locked_violation"`).
  2. Fires `OperatorAlerter.alert(...)` if an alerter has been wired into the store config.

The store **never** silently drops a forbidden write. The caller is always told (typed result in prod, throw elsewhere).

### 6. Reuse of #17 alerter

- Widen `InfrastructureErrorType` (in `packages/core/src/observability/operator-alerter.ts`) to include `"work_trace_locked_violation"`. This is a one-line enum extension, not a new event type.
- The `InfrastructureFailureSnapshot` shape is reused as-is. The richer diagnostic fields (`currentOutcome`, `lockedAt`, `rejectedFields`, `caller`) ride in the existing snapshot via additional optional keys, not a new type.
- `PrismaWorkTraceStore` gains an optional `auditLedger` and `operatorAlerter` constructor option, mirroring `PlatformIngressConfig`'s pattern. Both default to undefined / no-op.
- Bootstrap (`apps/api/src/bootstrap/storage.ts` or wherever the store is constructed) passes the same `auditLedger` + `operatorAlerter` instances used by `PlatformIngress`.

### 7. Schema migration

Single migration alongside the code change (per CLAUDE.md schema rule).

```sql
ALTER TABLE "WorkTrace" ADD COLUMN "lockedAt" TIMESTAMP(3);

UPDATE "WorkTrace"
SET "lockedAt" = COALESCE("completedAt", NOW())
WHERE "outcome" IN ('completed', 'failed');
```

**Migration note (in the migration's README/header comment):**

- Existing terminal traces are considered finalized at `completedAt` when available, migration time otherwise.
- Any operational script that still mutates old terminal traces will start failing after this migration. Such scripts must be fixed (the trace was already supposed to be immutable post-execution); they will not be preserved.

`pnpm db:check-drift` must pass before commit.

### 8. Helper module

New file: `packages/core/src/platform/work-trace-lock.ts`. Exports:

```ts
export const TERMINAL_OUTCOMES: ReadonlySet<WorkOutcome>;
export const ALLOWED_OUTCOME_TRANSITIONS: Readonly<Record<WorkOutcome, ReadonlySet<WorkOutcome>>>;

export class WorkTraceLockedError extends Error {
  readonly code: "WORK_TRACE_LOCKED";
  readonly diagnostic: WorkTraceLockDiagnostic;
}

export interface WorkTraceLockDiagnostic {
  traceId: string;
  workUnitId: string;
  currentOutcome: WorkOutcome;
  lockedAt: string | null;
  rejectedFields: string[];
  reason: string;
  caller?: string;
}

/**
 * Pure validator. Given the current persisted trace and a partial update,
 * return either ok (with computed lockedAt if applicable) or a structured rejection.
 */
export function validateUpdate(args: {
  current: WorkTrace;
  update: Partial<WorkTrace>;
  caller?: string;
}):
  | { ok: true; computedLockedAt: string | null }
  | { ok: false; diagnostic: WorkTraceLockDiagnostic };
```

The Prisma store calls `validateUpdate` inside a transaction (read current row, validate, write or reject) so race conditions can't slip through.

### 9. Tests (TDD)

**Pure validator unit tests (`work-trace-lock.test.ts`):**

- All allowed `outcome` transitions return ok.
- All disallowed `outcome` transitions return rejected with a rejected-field of `outcome`.
- Always-immutable fields rejected on any update where `current` exists.
- One-shot fields: first set succeeds; second set rejected.
- `parameters` mutable while `approvalOutcome` and `executionStartedAt` and `lockedAt` are all unset; sealed once any of those is set.
- Terminal-only fields: set on first terminal write succeeds; rewrite after `lockedAt` rejected.
- `modeMetrics` mutable up to lock; rejected after.
- Reaching a terminal outcome computes `lockedAt`; non-terminal outcome does not.

**Store integration tests (`prisma-work-trace-store-lock.test.ts` or in-memory equivalent):**

- Successful terminal write sets `lockedAt`.
- Subsequent `update()` after lock returns `{ ok: false, code: "WORK_TRACE_LOCKED", traceUnchanged: true, reason: <string> }` and does NOT modify the row (verify by reading back).
- In dev/test env (`NODE_ENV !== "production"`), the conflict throws `WorkTraceLockedError`.
- In production env (`NODE_ENV === "production"`), the conflict returns the typed result.
- When `auditLedger` is configured, a violation writes one infra-failure audit entry with `errorType: "work_trace_locked_violation"` and the rich diagnostic in the snapshot.
- When `operatorAlerter` is configured, a violation fires one alert.
- Lifecycle call site tests: existing `platform-lifecycle.test.ts` (or equivalent) continues to pass with the new return type.

**Migration tests:**

- A backfill test (or a docs-only `migration.sql` review) confirms existing terminal rows are stamped.

### 10. File touch list

**New:**

- `packages/core/src/platform/work-trace-lock.ts`
- `packages/core/src/platform/__tests__/work-trace-lock.test.ts`
- `packages/db/prisma/migrations/<timestamp>_add_work_trace_locked_at/migration.sql`
- `packages/db/src/stores/__tests__/prisma-work-trace-store-lock.test.ts` (or in-memory variant)

**Modified:**

- `packages/core/src/platform/work-trace.ts` — add `lockedAt?: string` field.
- `packages/core/src/platform/work-trace-recorder.ts` — change `WorkTraceStore.update()` return type; export `WorkTraceUpdateResult`.
- `packages/core/src/platform/platform-lifecycle.ts` — handle conflict result at the 3 call sites.
- `packages/db/prisma/schema.prisma` — add `lockedAt DateTime?` column.
- `packages/db/src/stores/prisma-work-trace-store.ts` — wrap `update()` in a transaction; call `validateUpdate`; set `lockedAt` automatically; emit audit/alert on violation; honor env-gated throw vs typed-return.
- `packages/core/src/observability/operator-alerter.ts` — extend `InfrastructureErrorType` with `"work_trace_locked_violation"`.
- Any in-memory `WorkTraceStore` test fakes — update to return the new `WorkTraceUpdateResult` shape.

## Invariants (load-bearing — implementation must preserve, tests must assert)

1. **Single chokepoint.** The lock invariant is enforced inside `WorkTraceStore.update`. It is NOT a domain-level check that another caller could bypass.
2. **Read-modify-write atomicity.** `PrismaWorkTraceStore.update` reads the current row, validates, and writes inside a single transaction. No race window.
3. **Automatic `lockedAt`.** Set by the store on the same write that transitions `outcome` into a terminal value. Callers do not pass `lockedAt`.
4. **Strict typed conflict result.** External shape is exactly `{ ok: false, code: "WORK_TRACE_LOCKED", traceUnchanged: true, reason: string }` — no extra fields. Diagnostic detail lives in the audit/alert payload only.
5. **Hybrid env behavior.** Throw in non-production; return typed conflict in production. Never silently drop a write.
6. **No recursive failure logging.** If the audit-ledger write itself throws inside the violation path, it is caught and `console.error`'d (consistent with #17). The alert still fires.
7. **No `AuditEventType` enum changes.** Reuse `action.failed` via `buildInfrastructureFailureAuditParams`.
8. **No widening of approval notifiers.** The infra-alert path is the #17 `OperatorAlerter`, not the `ApprovalNotifier` family.
9. **Backfill preserves consistency.** All existing rows with `outcome IN ('completed', 'failed')` get `lockedAt` set. After the migration, every terminal row in the DB is locked.

## Out-of-scope clarifications (recap)

This PR does NOT add:

- Hash chain on `WorkTrace`.
- Append-only revision table.
- Storage-layer (DB) triggers preventing UPDATE.
- Cryptographic verification on read (no hash recomputation).
- Tamper-evidence UI / dashboard.
- Historical hash backfill.

Any of these can land as a follow-up under the post-beta enterprise-trust hardening project.

## Acceptance

- [x] `WorkTrace` carries `lockedAt`; set automatically on terminal transition.
- [x] `WorkTraceStore.update()` returns typed result; rejects forbidden mutations.
- [x] Three lifecycle call sites handle the conflict result.
- [x] Hybrid env behavior: throw in dev/test/CI, typed result in prod.
- [x] Audit + alert wired via #17 `OperatorAlerter`.
- [x] Migration backfills existing terminal rows.
- [x] Tests cover validator, store integration, env-gated throw vs return, audit/alert wiring.

## PR scope statement (for the PR body)

This PR enforces a single bounded invariant: completed `WorkTrace`s cannot be silently rewritten. It is intentionally **not** the full #19 launch-blocker scope. Deferred to post-beta:

- Hash chain.
- Append-only revisions.
- Storage-layer triggers.
- Cryptographic verification on read.
- Tamper-evidence UI.
