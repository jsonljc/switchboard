# WorkTrace cryptographic integrity via anchored content hash

**Status:** spec
**Date:** 2026-04-29
**Branch slug:** `fix/launch-work-trace-integrity`
**Audit reference:** `.audit/08-launch-blocker-sequence.md` Blocker #19 ("WorkTrace lacks cryptographic integrity")
**Approach:** D — anchored content-hash via AuditLedger
**Effort:** L (day+)

## Summary

WorkTrace is canonical persistence for governed revenue actions, but
every field except `lockedAt` (PR #293) is mutable through
`WorkTraceStore.update()` with no integrity field, no chain anchor, and
no read-time verification. Tampering with `executionOutputs`,
`approvalOutcome`, `approvalRespondedBy`, or any governance field is
undetected today.

This slice adds a SHA-256 `contentHash` plus monotonic `traceVersion`
to every WorkTrace row and pairs every persist and update with an
anchoring `AuditEntry` (event types `work_trace.persisted` /
`work_trace.updated`) on the same Prisma transaction. The
existing `AuditLedger` SHA-256 chain (`packages/core/src/audit/`)
provides transitive global integrity for free.

Reads recompute the hash, locate the version-exact anchor, and return
a typed `IntegrityVerdict` (`"ok" | "mismatch" | "missing_anchor" |
"skipped"`). Reads are fail-open with operator alerts on mismatch.
Execution admission boundaries call `assertExecutionAdmissible`, which
is **fail-closed** on every status except `"ok"`, unless a typed
operator override is threaded through (which itself records a
`work_trace.integrity_override` AuditEntry).

Backfill is forward-only: pre-migration rows return `"skipped"` and are
**not** admissible for execution. The migration timestamp acts as the
trust cutoff.

This PR closes Blocker #19 with the acceptance criterion "Test
verifies hash validation on read" satisfied for both visibility (read
path) and enforcement (execution admission).

## Audit findings

- `WorkTrace` interface (`packages/core/src/platform/work-trace.ts`)
  has no integrity field. All fields except `lockedAt` are caller-set.
- Prisma `WorkTrace` model (`packages/db/prisma/schema.prisma:1566`)
  has no integrity column.
- `WorkTraceStore.update()`
  (`packages/core/src/platform/work-trace-recorder.ts:23`) is the only
  mutation path. Implemented at
  `packages/db/src/stores/prisma-work-trace-store.ts:156` inside
  `prisma.$transaction` with terminal-state lock validation (PR #293).
- Four `update()` call sites — three in
  `packages/core/src/platform/platform-lifecycle.ts` (`:360`, `:558`,
  `:573`), one in
  `packages/core/src/approval/lifecycle-service.ts:147`.
- Persist call site:
  `packages/core/src/platform/platform-ingress.ts:325`
  (`persistTrace`), with built-in 3× retry + jittered backoff and a
  `trace_persist_failed` infra-failure audit on terminal failure.
- `AuditLedger` (`packages/core/src/audit/ledger.ts:51`) already
  provides `record(...)` with `appendAtomic` +
  `pg_advisory_xact_lock` chain serialization.
- `LedgerStorage.appendAtomic`
  (`packages/core/src/audit/ledger.ts:30`) currently opens its own
  `prisma.$transaction` and cannot join a parent transaction. Joining
  is required to make WorkTrace + AuditEntry writes atomic.
- `AuditEventTypeSchema` is a closed Zod enum
  (`packages/schemas/src/audit.ts:17`); new event types must be added
  there.
- `canonicalizeSync` (`packages/core/src/audit/canonical-json.ts`) and
  `sha256` (`packages/core/src/audit/canonical-hash.ts`) are
  immediately reusable for hashing WorkTrace contents.
- `PrismaWorkTraceStore` already accepts `auditLedger?` and
  `operatorAlerter?` for the locked-violation path
  (`prisma-work-trace-store.ts:9-21`). This slice promotes
  `auditLedger` to required.
- `validateUpdate` and the lock semantics from PR #293 are
  unaffected; this slice composes with them.

## Decisions

### Caveat resolutions (from brainstorm)

- **Backfill: A — forward-only.** Schema add only. Pre-migration rows
  keep `contentHash IS NULL` and return `"skipped"`. They are
  read-visible but execution-inadmissible.
- **Verification UX: B — fail-open + alert.** Reads return a typed
  `IntegrityVerdict` and an `OperatorAlert` on mismatch. The runtime
  is not destabilized by a hash bug.
- **Transactional pattern: A — single Prisma transaction.**
  `LedgerStorage.appendAtomic` gains `options?: { externalTx?: unknown
}` so `PrismaWorkTraceStore` can wrap WorkTrace write + AuditEntry
  append on the same `prisma.$transaction`.

### Architectural refinements

- **Two-tier verification policy.** Read path is fail-open. Execution
  admission (`assertExecutionAdmissible`) is fail-closed on
  `"mismatch"`, `"missing_anchor"`, and `"skipped"` (without operator
  override).
- **Version-exact anchor matching.** Hash input includes
  `traceVersion`; reads query the AuditEntry whose snapshot's
  `traceVersion` exactly matches the row's current `traceVersion`. No
  "latest anchor" fallbacks.
- **`traceVersion` invariant.** New persists set `traceVersion = 1`;
  every hash-relevant update increments by 1. The Prisma column
  defaults to `0` to allow forward-only backfill of pre-migration
  rows, but a row with `contentHash IS NOT NULL` AND `traceVersion <=
0` is an invariant violation. The verifier treats this case as
  `"missing_anchor"` (never `"ok"`); covered by a dedicated test
  under §4.
- **Migration cutoff for `"skipped"`.**
  `WORK_TRACE_INTEGRITY_CUTOFF_AT` is the migration timestamp
  constant. `"skipped"` is only returned for rows with `requestedAt <
CUTOFF_AT` AND `contentHash IS NULL`. Post-cutoff rows missing a
  hash → `"missing_anchor"` + alert. `"skipped"` is rejected by
  execution admission unconditionally — pre-migration traces cannot
  drive new external effects.
- **Hash-input exclusion rule.** Hash includes everything in the
  `WorkTrace` interface except `contentHash`, `traceVersion`, and
  `lockedAt`. All other fields — `parameters`,
  `governanceConstraints`, `approvalOutcome`, `approvalRespondedBy`,
  `approvalRespondedAt`, `executionOutputs`, `error`, `modeMetrics`
  — are inside the hash. Future field additions must justify
  exclusion. Implementation note: `buildWorkTraceHashInput` returns a
  fresh object that explicitly omits the excluded fields rather than
  relying on `canonicalizeSync`'s undefined-skip behavior, so the
  exclusion is auditable from one place.
- **Distinct event types.** `work_trace.persisted` and
  `work_trace.updated` are separate, so the chain has explicit
  cardinality (1 persist + N updates per workUnit). Plus
  `work_trace.integrity_override` for admission overrides.

### Rejected alternatives

- **Backfill B (one-time backfill at migration).** Pre-launch system
  has no production WorkTrace history worth retro-anchoring. Saved
  for the follow-up reconciler if it ever becomes necessary.
- **Verification A (fail-closed on read).** A hash-computation bug
  would become a runtime outage. Execution admission gives us the
  enforcement we need without coupling read-path stability to hash
  correctness.
- **Transactional B (two-phase + reconciler cron).** Requires a new
  cron, introduces an "unanchored window" where reads see
  `"missing_anchor"` for legitimately-recent rows, and complicates the
  read-path semantics. Choice A keeps the integrity invariant trivial
  to reason about: the row exists ⇔ the anchor exists.
- **Transactional C (outbox).** Outbox is for cross-system event
  delivery, not for a same-database integrity invariant.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ WRITE PATH (persist + every update)                             │
└─────────────────────────────────────────────────────────────────┘

PlatformIngress.persistTrace               ApprovalLifecycle / Lifecycle
        │                                            │
        ▼                                            ▼
PrismaWorkTraceStore.persist()      PrismaWorkTraceStore.update()
        │                                            │
        └──────────────────┬─────────────────────────┘
                           ▼
            prisma.$transaction(async (tx) => {
              ① contentHash = sha256(canonicalize(traceForHashing))
              ② tx.workTrace.create / .update with contentHash + traceVersion
              ③ auditLedger.record({ ..., tx })   ← new external-tx path
                    └─ inside: pg_advisory_xact_lock (same tx)
                              + chain append AuditEntry
                                  type: "work_trace.persisted" or
                                        "work_trace.updated"
                                  snapshot: { workUnitId, traceId,
                                              contentHash, traceVersion,
                                              hashAlgorithm, hashVersion,
                                              previousHash?, previousVersion?,
                                              changedFields? }
            })
              ↑ both commit, or both roll back

┌─────────────────────────────────────────────────────────────────┐
│ READ PATH (every getByWorkUnitId / getByIdempotencyKey)         │
└─────────────────────────────────────────────────────────────────┘

caller → store.getByWorkUnitId(id)
            │
            ▼
        row = prisma.workTrace.findUnique
            │
            ├─ contentHash IS NULL  AND  requestedAt < CUTOFF_AT
            │      → integrityVerified: "skipped"  → return
            │
            ├─ contentHash IS NULL  AND  requestedAt >= CUTOFF_AT
            │      → operatorAlerter.alert(missing_anchor)
            │      → integrityVerified: "missing_anchor" → return
            │
            └─ contentHash present:
                 if (row.traceVersion <= 0)
                     → "missing_anchor" + alert  (invariant violation)
                 recomputed = sha256(canonicalize(traceForHashing))
                 anchor     = auditLedger.findAnchor({
                                entityType: "work_trace",
                                entityId: workUnitId,
                                eventType: row.traceVersion === 1
                                             ? "work_trace.persisted"
                                             : "work_trace.updated",
                                traceVersion: row.traceVersion,
                              })
                 ├─ recomputed === row.contentHash AND anchor present
                 │      → "ok"  → return
                 ├─ recomputed !== row.contentHash
                 │      → operatorAlerter.alert(mismatch)
                 │      → "mismatch" → return  (fail-open)
                 └─ no version-exact anchor found
                        → operatorAlerter.alert(missing_anchor)
                        → "missing_anchor" → return  (fail-open)

┌─────────────────────────────────────────────────────────────────┐
│ EXECUTION ADMISSION                                             │
└─────────────────────────────────────────────────────────────────┘

caller (platform-lifecycle, approval-lifecycle, future) reads trace
        │
        ▼
    assertExecutionAdmissible(trace, integrity, override?)
        ├─ "ok"                               → return (admit)
        ├─ "mismatch" | "missing_anchor"
        │  | "skipped"  + no override         → throw WorkTraceIntegrityError
        └─ same  + override                   → record work_trace.integrity_override
                                                AuditEntry → return (admit)
```

### Core invariants

- **Atomic pairing.** WorkTrace write and integrity AuditEntry write
  commit or roll back together. No half-state.
- **Version-exact anchoring.** Every `(workUnitId, traceVersion)` pair
  has at most one valid anchor; reads verify against that anchor only.
- **Forward-only trust.** Pre-migration rows are read-visible but
  execution-inadmissible. The cutoff is the migration timestamp.
- **Fail-closed on execution.** Any verdict other than `"ok"` blocks
  external effects unless an operator override is recorded as its own
  audit entry.
- **Misconfiguration is impossible.** `PrismaWorkTraceStore` requires
  an `AuditLedger` at construction.

## Components & file map

### Schema layer (`packages/schemas`)

- **`src/audit.ts`** — extend `AuditEventTypeSchema` with three new
  values: `"work_trace.persisted"`, `"work_trace.updated"`,
  `"work_trace.integrity_override"`.
- **`src/__tests__/schemas.test.ts`** — assert the three new values
  parse; assert existing values still parse.

### Core platform layer (`packages/core/src/platform`)

- **`work-trace.ts`** — extend `WorkTrace` interface:
  ```ts
  export interface WorkTrace {
    // ... existing fields ...
    /** SHA-256 of canonical-JSON of hash-included fields. Set by store on persist/update. */
    contentHash?: string;
    /** Monotonic per workUnitId. 1 on persist; +1 per successful update. */
    traceVersion?: number;
    lockedAt?: string;
  }
  ```
  Both fields are typed optional because pre-migration reads return
  rows without them.
- **NEW `work-trace-hash.ts`** — pure module, no I/O:

  ```ts
  import { canonicalizeSync } from "../audit/canonical-json.js";
  import { sha256 } from "../audit/canonical-hash.js";
  import type { WorkTrace } from "./work-trace.js";

  export const WORK_TRACE_HASH_VERSION = 1;
  export const WORK_TRACE_HASH_EXCLUDED_FIELDS = [
    "contentHash",
    "traceVersion",
    "lockedAt",
  ] as const satisfies readonly (keyof WorkTrace)[];

  export function buildWorkTraceHashInput(
    trace: WorkTrace,
    traceVersion: number,
  ): Record<string, unknown>;

  export function computeWorkTraceContentHash(trace: WorkTrace, traceVersion: number): string;
  ```

- **NEW `work-trace-integrity.ts`** — verifier and admission helper,
  also pure (admission helper takes `auditLedger` as a dependency for
  the override-record side-effect):

  ```ts
  export type IntegrityVerdict =
    | { status: "ok" }
    | { status: "mismatch"; expected: string; actual: string }
    | { status: "missing_anchor"; expectedAtVersion: number }
    | { status: "skipped"; reason: "pre_migration" };

  export function verifyWorkTraceIntegrity(params: {
    trace: WorkTrace;
    rowContentHash: string | null;
    rowTraceVersion: number;
    rowRequestedAt: string;
    anchor: AuditEntry | null;
    cutoffAt: string;
  }): IntegrityVerdict;

  export class WorkTraceIntegrityError extends Error {
    constructor(public readonly verdict: IntegrityVerdict, public readonly workUnitId: string);
  }

  export interface IntegrityOverride {
    actorId: string;
    reason: string;
    overrideAt: string;
  }

  export async function assertExecutionAdmissible(params: {
    trace: WorkTrace;
    integrity: IntegrityVerdict;
    override?: IntegrityOverride;
    auditLedger?: AuditLedger;   // intentionally optional: the no-override
                                 // happy path needs no ledger. Override
                                 // path throws if ledger is missing —
                                 // overrides MUST be auditable.
  }): Promise<void>;
  ```

- **`work-trace-recorder.ts`** — `WorkTraceStore` interface gains the
  `IntegrityVerdict` return shape on reads:

  ```ts
  export interface WorkTraceReadResult {
    trace: WorkTrace;
    integrity: IntegrityVerdict;
  }

  export interface WorkTraceStore {
    persist(trace: WorkTrace): Promise<void>;
    getByWorkUnitId(workUnitId: string): Promise<WorkTraceReadResult | null>;
    getByIdempotencyKey(key: string): Promise<WorkTraceReadResult | null>;
    update(
      workUnitId: string,
      fields: Partial<WorkTrace>,
      options?: { caller?: string },
    ): Promise<WorkTraceUpdateResult>;
  }
  ```

  `WorkTraceUpdateResult.trace` continues to be the post-update
  `WorkTrace`; the store recomputes hash + version inside the update
  tx.

### Audit layer (`packages/core/src/audit`)

- **`ledger.ts`** — two changes:
  - `LedgerStorage.appendAtomic` signature becomes:
    ```ts
    appendAtomic?(
      buildEntry: (previousEntryHash: string | null) => Promise<AuditEntry>,
      options?: { externalTx?: unknown },   // unknown so core does not depend on Prisma types
    ): Promise<AuditEntry>;
    ```
    `AuditLedger.record(...)` gains optional `tx?: unknown` and
    forwards it to `appendAtomic`. `InMemoryLedgerStorage.appendAtomic`
    ignores `externalTx`.
  - `AuditLedger.findAnchor(params)` — new method for deterministic
    version-exact anchor lookup:
    ```ts
    findAnchor(params: {
      entityType: string;
      entityId: string;
      eventType: AuditEventType;
      traceVersion: number;
    }): Promise<AuditEntry | null>;
    ```
    Backed by a new `LedgerStorage.findBySnapshotField?` capability:
    Prisma implementation uses a JSONB path filter
    (`snapshot.path(['traceVersion'])`) against the indexable JSONB
    column to make the lookup O(matches) rather than O(history).
    `InMemoryLedgerStorage` implements it via in-memory filter. If a
    storage backend doesn't support the capability, `findAnchor`
    falls back to a query-then-filter using `entityId + eventType`
    ordered newest-first with no arbitrary limit (the fallback is
    documented as O(history) and only acceptable for in-memory
    backends and tests).
- **No changes to `canonical-hash.ts`, `canonical-json.ts`,
  `evidence.ts`, `redaction.ts`.**

### DB layer (`packages/db`)

- **`prisma/schema.prisma`** — add to `WorkTrace` model:
  ```prisma
  contentHash   String?
  traceVersion  Int     @default(0)
  ```
  Both nullable/zero-default for forward-only backfill of existing
  rows. New rows persist them as non-null/positive.
- **`prisma/migrations/<ts>_worktrace_integrity/migration.sql`** —
  adds the two columns with defaults; no backfill, no NOT-NULL
  constraint. The migration timestamp is the source of truth for
  `WORK_TRACE_INTEGRITY_CUTOFF_AT`.
- **NEW `src/integrity-cutoff.ts`** — exports
  `WORK_TRACE_INTEGRITY_CUTOFF_AT: string` (ISO timestamp constant).
  This is the **migration commit timestamp**, baked in as a literal
  string, not derived at runtime from when the migration ran. That
  makes the cutoff deterministic across dev / staging / prod
  regardless of when each environment migrates. Imported by the
  store on read-path verification.
- **`src/storage/prisma-ledger-storage.ts`** — three changes:
  - `appendAtomic` accepts `options?: { externalTx?:
PrismaTransactionClient }`. When `externalTx` is provided, runs
    `pg_advisory_xact_lock(...)` + chain append on that tx instead
    of opening a new one. Existing single-write callers unaffected.
  - Implements `findBySnapshotField` (or equivalent) to back
    `AuditLedger.findAnchor` with a JSONB path filter. Adds an index
    on `(entityType, entityId, eventType, (snapshot ->>
'traceVersion'))` if profiling shows the lookup is hot; spec
    leaves the index decision to the implementer based on EXPLAIN
    output.
  - No change to existing `query`, `getLatest`, `getById`, `append`.
- **`src/stores/prisma-work-trace-store.ts`** — substantial rewrite:
  - Constructor requires both `auditLedger` and `operatorAlerter`.
    `auditLedger` is non-negotiable — without it, integrity is
    unenforceable. `operatorAlerter` is also required, but tests and
    dev environments must pass an **explicit** `NoopOperatorAlerter`
    rather than rely on a silent default. The store does NOT
    construct a noop fallback internally — fail-open without an
    explicit alerter would be silent enforcement loss, which the
    doctrine forbids. Constructor throws synchronously with
    `Error("PrismaWorkTraceStore requires auditLedger and
operatorAlerter")` if either is missing.
  - **NEW `src/observability/noop-operator-alerter.ts`** —
    `NoopOperatorAlerter` exported for use in tests and dev wiring.
    Existence is itself a contract: choosing the noop is an explicit
    decision recorded at the bootstrap site, not a hidden default.
  - `persist()` wraps `tx.workTrace.create` + integrity AuditEntry in
    `prisma.$transaction`.
  - `update()` continues to wrap inside `prisma.$transaction`; after
    a successful row update, increments `traceVersion`, recomputes
    `contentHash`, and writes a `work_trace.updated` AuditEntry on
    the same tx.
  - `getByWorkUnitId` / `getByIdempotencyKey` return
    `WorkTraceReadResult`. They fetch the row, then query the latest
    matching anchor (by `entityId = workUnitId`, `entityType =
"work_trace"`, snapshot's `traceVersion === row.traceVersion`),
    then call `verifyWorkTraceIntegrity`. On `"mismatch"` or
    `"missing_anchor"`, fire `operatorAlerter.alert(integrity_alert)`
    via `safeAlert`.
  - `mapRowToTrace` is extended to populate `contentHash` and
    `traceVersion` from row columns onto the returned `WorkTrace`.

### Execution-admission integration sites

- **`packages/core/src/platform/platform-lifecycle.ts`** — at every
  site that loads a trace and proceeds to execution/continuation
  (`:360`, `:558`, `:573`), call `assertExecutionAdmissible(...)`
  before consuming. Type-driven: `getByWorkUnitId` no longer returns
  `WorkTrace` directly, so the compiler enforces the new shape at
  every call site.
- **`packages/core/src/approval/lifecycle-service.ts:147`** — same
  treatment before the `traceStore.update(...)` continuation call.
- **`packages/core/src/platform/platform-ingress.ts`** —
  `persistTrace` doesn't read; no admission check needed there.
- **Apps (api/chat/dashboard/mcp-server)** — read sites that only
  display traces (audit page, dashboards) consume `{trace, integrity}`
  and surface `integrity.status` in the UI but **do not fail-close**.
  Implementation plan will enumerate the diff once we audit call
  sites; no functional UX change in this slice.

### App bootstrap

- **`apps/api/src/bootstrap/*` and equivalents in
  `apps/chat`, `apps/dashboard`, `apps/mcp-server`** —
  `PrismaWorkTraceStore` constructor wiring grows a required
  `auditLedger` argument. Every existing bootstrap already constructs
  an `AuditLedger`; just pass it in. The implementation plan will
  name each bootstrap file in the file map.

### Explicit non-touches

- `canonical-hash.ts` / `canonical-json.ts` are reused as-is.
- `OperatorAlerter` is reused as-is (already a dep of
  `PrismaWorkTraceStore`).
- No outbox, no cron, no background reconciler.
- No change to `WorkTrace` lock semantics or `lockedAt` behavior
  (PR #293 stays intact).
- No change to AuditEntry write paths outside `WorkTraceStore`.
- No retroactive hashing of existing rows.
- Risk #20 (ApprovalLifecycle parallel persistence) is **not**
  addressed — orthogonal; this slice intentionally hooks the
  `WorkTraceStore` layer so all paths get integrity, including the
  parallel one.

## Data flow & error handling

### Persist (`WorkTraceStore.persist`)

```
persist(trace):
  prisma.$transaction(async (tx) => {
    traceVersion  = 1
    contentHash   = computeWorkTraceContentHash(trace, traceVersion)

    try {
      await tx.workTrace.create({ data: { ...trace, contentHash, traceVersion } })
    } catch (err) {
      if (P2002 unique-constraint AND trace.idempotencyKey) {
        return  // existing idempotent-skip path; tx rolls back, no AuditEntry written
      }
      throw err
    }

    await auditLedger.record({
      eventType:       "work_trace.persisted",
      actorType:       trace.actor.type,
      actorId:         trace.actor.id,
      entityType:      "work_trace",
      entityId:        trace.workUnitId,
      riskCategory:    "low",
      visibilityLevel: "system",
      summary:         `WorkTrace ${trace.workUnitId} persisted at v${traceVersion}`,
      organizationId:  trace.organizationId,
      traceId:         trace.traceId,
      snapshot: {
        workUnitId:    trace.workUnitId,
        traceId:       trace.traceId,
        contentHash,
        traceVersion,
        hashAlgorithm: "sha256",
        hashVersion:   WORK_TRACE_HASH_VERSION,
      },
    }, { tx })
  })
```

**Failure modes:**

| Cause                                                          | Behavior                                                                                                                                                                   |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tx.workTrace.create` non-idempotent throw                     | tx rolls back; existing `PlatformIngress.persistTrace` retry loop (3× jittered) catches it; on terminal failure, existing `trace_persist_failed` infra-failure audit fires |
| `auditLedger.record` throws                                    | tx rolls back; row never exists; same retry path                                                                                                                           |
| Idempotent unique-constraint hit (`P2002` on `idempotencyKey`) | tx rolls back; no second AuditEntry. The original persist already produced its anchoring AuditEntry                                                                        |

### Update (`WorkTraceStore.update`)

```
update(workUnitId, fields, options):
  prisma.$transaction(async (tx) => {
    row     = tx.workTrace.findUnique({ where: { workUnitId } })
    if (!row) throw new Error(`WorkTrace not found: ${workUnitId}`)

    current = mapRowToTrace(row)
    validation = validateUpdate({ current, update: fields, caller: options?.caller })
    if (!validation.ok) {
      // existing locked-violation path, unchanged
      await handleViolation(validation.diagnostic)
      ...return locked-error tuple...
    }

    data = buildPrismaUpdateData(fields, validation)

    // Decide whether this update is hash-relevant.
    // A `lockedAt`-only write (validation.computedLockedAt set, no business fields)
    // does not change any hashed field, so it neither bumps traceVersion nor anchors.
    // The existing anchor remains valid because lockedAt is excluded from the hash.
    hashRelevantKeys = Object.keys(data).filter(
      k => k !== "lockedAt" && k !== "contentHash" && k !== "traceVersion"
    )
    if (hashRelevantKeys.length === 0) {
      if (Object.keys(data).length === 0) {
        // no-op — caller passed empty fields
        return { ok: true, trace: mapRowToTrace(row) }
      }
      // lockedAt-only write: persist it, but do not bump version, do not anchor
      updatedRow = await tx.workTrace.update({ where: { workUnitId }, data })
      return { ok: true, trace: mapRowToTrace(updatedRow) }
    }

    nextVersion = (row.traceVersion ?? 0) + 1
    merged      = applyFieldsToTrace(current, fields, validation.computedLockedAt)
    nextHash    = computeWorkTraceContentHash(merged, nextVersion)

    data.contentHash  = nextHash
    data.traceVersion = nextVersion

    updatedRow = await tx.workTrace.update({ where: { workUnitId }, data })

    await auditLedger.record({
      eventType:       "work_trace.updated",
      actorType:       "system",
      actorId:         options?.caller ?? "unknown",
      entityType:      "work_trace",
      entityId:        workUnitId,
      riskCategory:    "low",
      visibilityLevel: "system",
      summary:         `WorkTrace ${workUnitId} updated to v${nextVersion}`,
      organizationId:  current.organizationId,
      traceId:         current.traceId,
      snapshot: {
        workUnitId,
        traceId:         current.traceId,
        contentHash:     nextHash,
        traceVersion:    nextVersion,
        previousHash:    row.contentHash,
        previousVersion: row.traceVersion,
        // Business-intent fields the caller actually changed.
        // Excludes computed integrity fields (contentHash, traceVersion)
        // AND store-derived fields (lockedAt) so the audit row reflects
        // operator/system intent, not framework bookkeeping.
        changedFields:   hashRelevantKeys,
        hashAlgorithm:   "sha256",
        hashVersion:     WORK_TRACE_HASH_VERSION,
      },
    }, { tx })

    return { ok: true, trace: mapRowToTrace(updatedRow) }
  })
```

**Failure modes:**

| Cause                                                            | Behavior                                                                                                                                      |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Lock violation                                                   | Existing path (`handleViolation` + `WorkTraceLockedError`); no row mutation; no integrity AuditEntry                                          |
| Empty `data` (caller passed no fields)                           | No row write, no version bump, no AuditEntry                                                                                                  |
| `lockedAt`-only write (terminal-locking with no business fields) | Row is updated to set `lockedAt`; no version bump, no AuditEntry. Existing anchor remains valid because `lockedAt` is excluded from the hash. |
| `tx.workTrace.update` throws                                     | tx rolls back; caller sees error; no half-state                                                                                               |
| `auditLedger.record` throws                                      | tx rolls back; row reverts to pre-update state; caller sees error                                                                             |

**Update-flow integrity admission policy:** an `update()` call does
**not** verify integrity against the existing row before overwriting.
Updates supersede integrity — the threat model is "tampering goes
undetected when consumed for execution"; an update is itself a write
event that produces a fresh anchor.

**Threat-model caveat:** `update()` creates a new trusted version. It
does **not** certify that the prior row was trustworthy. A corrupted
trace could in principle be read, mutated, and re-anchored — and from
that point forward the new anchor would verify cleanly, masking the
historical corruption. To prevent this:

> **Caller rule (load-bearing):** Any caller that updates a WorkTrace
> as part of a path that will produce external effects MUST first
> call `getByWorkUnitId` and `assertExecutionAdmissible(...)` on the
> read result before invoking `update`. Pure store-internal updates
> (e.g. infrastructure-state writes that drive no external effect) may
> skip the read-then-assert pattern.

This rule applies at every existing `update()` call site
(`platform-lifecycle.ts:360, :558, :573`, `lifecycle-service.ts:147`)
and is enforced by tests under §4 (Execution-admission integration
tests). The store cannot enforce the rule itself — it has no view of
caller intent — so the rule is doctrine + test coverage, not a
runtime guard.

### Read (`getByWorkUnitId`, `getByIdempotencyKey`)

```
getByWorkUnitId(workUnitId):
  row = prisma.workTrace.findUnique({ where: { workUnitId } })
  if (!row) return null
  trace = mapRowToTrace(row)

  // Forward-only backfill check
  if (row.contentHash === null) {
    if (row.requestedAt < CUTOFF_AT) {
      return { trace, integrity: { status: "skipped", reason: "pre_migration" } }
    }
    // Post-cutoff row missing hash → invariant broken
    await safeAlert(operatorAlerter, buildIntegrityAlert("missing_anchor", trace, null))
    return { trace, integrity: { status: "missing_anchor", expectedAtVersion: row.traceVersion ?? 0 } }
  }

  // Re-derive hash from row contents
  recomputed = computeWorkTraceContentHash(trace, row.traceVersion)

  // Invariant guard: post-cutoff row with hash but no positive version is broken.
  if (row.traceVersion <= 0) {
    await safeAlert(operatorAlerter, buildIntegrityAlert("missing_anchor", trace, null))
    return { trace, integrity: { status: "missing_anchor", expectedAtVersion: row.traceVersion } }
  }

  // Find the version-exact anchor.
  // Use AuditLedger.findAnchor — a new method (see Audit layer) that targets
  // entityId + eventType + snapshot.traceVersion deterministically, with no
  // arbitrary limit. Implementation queries by entityId/eventType ordered
  // newest-first and filters in storage by snapshot.traceVersion via a
  // structured-JSON predicate (Postgres JSONB path expression in Prisma) so
  // the lookup is O(matches) regardless of update count.
  // anchor.snapshot is typed Record<string, unknown>; narrow with small
  // helpers (`getString`, `getNumber`) — helpers live in work-trace-integrity.ts.
  anchor = await auditLedger.findAnchor({
    entityType: "work_trace",
    entityId:   row.workUnitId,
    eventType:  row.traceVersion === 1 ? "work_trace.persisted" : "work_trace.updated",
    traceVersion: row.traceVersion,
  })

  verdict = verifyWorkTraceIntegrity({
    trace,
    rowContentHash:  row.contentHash,
    rowTraceVersion: row.traceVersion,
    rowRequestedAt:  row.requestedAt.toISOString(),
    anchor,
    cutoffAt:        CUTOFF_AT,
  })

  if (verdict.status === "mismatch" || verdict.status === "missing_anchor") {
    await safeAlert(operatorAlerter, buildIntegrityAlert(verdict.status, trace, anchor))
    // fail-open: still return the trace
  }

  return { trace, integrity: verdict }
```

**Failure modes:**

| Cause                                | Behavior                                                                                                                                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prisma.workTrace.findUnique` throws | propagate (DB outage; not our problem to mask)                                                                                                                                |
| `auditLedger.findAnchor` throws      | log + alert (`integrity_check_unavailable`); return `{trace, integrity: {status: "missing_anchor", ...}}`. Fail-open per Section 1; execution admission still closes the door |
| `operatorAlerter.alert` throws       | caught by existing `safeAlert` + console.error; never propagates from a read                                                                                                  |
| `computeWorkTraceContentHash` throws | propagate; this is a programmer error worth crashing on                                                                                                                       |

### Execution admission (`assertExecutionAdmissible`)

```
assertExecutionAdmissible({ trace, integrity, override?, auditLedger? }):
  switch (integrity.status) {
    case "ok":
      return  // pass
    case "skipped":
    case "mismatch":
    case "missing_anchor":
      if (!override) {
        throw new WorkTraceIntegrityError(integrity, trace.workUnitId)
      }
      if (!auditLedger) {
        throw new Error("override path requires auditLedger to record decision")
      }
      await auditLedger.record({
        eventType:       "work_trace.integrity_override",
        actorType:       "user",
        actorId:         override.actorId,
        entityType:      "work_trace",
        entityId:        trace.workUnitId,
        riskCategory:    "high",
        visibilityLevel: "admin",
        summary:         `Integrity override (${integrity.status}) by ${override.actorId}: ${override.reason}`,
        organizationId:  trace.organizationId,
        traceId:         trace.traceId,
        snapshot: {
          workUnitId:      trace.workUnitId,
          integrityStatus: integrity.status,
          reason:          override.reason,
          overrideAt:      override.overrideAt,
        },
      })
      return  // admitted
  }
```

**Where called:**

- `platform-lifecycle.ts:360` (continuation read)
- `platform-lifecycle.ts:558`
- `platform-lifecycle.ts:573`
- `approval/lifecycle-service.ts:147`
- Wherever a future caller loads `WorkTrace` and intends to drive an
  external effect.

### Alert payload shape

`buildIntegrityAlert(status, trace, anchor?)` produces an
`OperatorAlert` with:

- `kind: "work_trace_integrity"`
- `severity: status === "mismatch" ? "critical" : "warning"`
- `summary`: human description
- `metadata`: `{ workUnitId, traceId, organizationId, intent, status,
expectedHash, actualHash, anchorEntryId }`

Reuses the existing `OperatorAlerter` interface; no new alert
channel.

### What this design does _not_ protect against

Documented as explicit non-goals so the threat model is honest:

- **AuditEntry tampering.** If an attacker can rewrite both the
  WorkTrace row and the anchoring AuditEntry, our check passes.
  Defense for this is the existing AuditLedger hash-chain
  (`previousEntryHash`) and `verifyChain` — orthogonal to this slice.
- **Simultaneous database compromise.** Both the integrity field and
  its anchor live in the same Postgres. A DB-level mass-rewrite that
  also reconstructs the chain is undetectable from inside. Out of
  scope.
- **In-flight tampering.** WorkTrace built in `PlatformIngress` and
  shipped to `persist()` is not signed at the source; integrity
  starts at the persist boundary, not at construction.
- **Pre-migration rows.** `requestedAt < CUTOFF_AT` rows are
  explicitly untrusted for execution per Decisions §3.

## Testing strategy

### Section acceptance criteria

This section passes when:

1. Hash function is proven deterministic and field-exclusion-correct.
2. Verifier returns the correct verdict for every input combination.
3. Persist + update + read paths produce paired WorkTrace + AuditEntry
   writes that commit/roll back atomically.
4. Forward-only backfill semantics are enforced at the cutoff
   boundary.
5. Execution-admission helper fails closed without override and
   admits with override (recording an override audit entry).
6. Integration tests prove tampering with either the row or the
   anchor is detected on read.
7. All existing WorkTrace tests still pass with the new return shape.

### 1. Hash + verifier unit tests

`packages/core/src/platform/__tests__/work-trace-hash.test.ts` (new)

- identical traces → identical hashes
- key-order-independent input objects → same hash (canonical-JSON
  contract)
- changing any included field changes the hash (parameterized over
  every field in `WorkTrace` minus excluded list)
- changing `contentHash`, `traceVersion`, or `lockedAt` does NOT
  change the hash (excluded fields)
- different `traceVersion` with otherwise identical content →
  different hash
- `WORK_TRACE_HASH_EXCLUDED_FIELDS` matches what
  `buildWorkTraceHashInput` actually omits (asserted by reflection —
  guards against silent drift)

`packages/core/src/platform/__tests__/work-trace-integrity.test.ts` (new)

`verifyWorkTraceIntegrity` cases:

- contentHash matches recomputed + anchor present + anchor.snapshot
  matches → `"ok"`
- contentHash != recomputed → `"mismatch"` with expected/actual
- contentHash null + requestedAt < cutoff → `"skipped"` reason
  `"pre_migration"`
- contentHash null + requestedAt >= cutoff → `"missing_anchor"`
- contentHash present + no anchor found → `"missing_anchor"` with
  `expectedAtVersion`
- contentHash present + anchor at different version →
  `"missing_anchor"`
- contentHash present + anchor.snapshot.contentHash !=
  row.contentHash → `"mismatch"`
- **invariant guard:** contentHash present + traceVersion <= 0 →
  `"missing_anchor"`, never `"ok"`. Parameterized over
  `traceVersion ∈ {0, -1}` and over both null-anchor and
  matching-anchor cases — the verdict must remain
  `"missing_anchor"` regardless of anchor presence, because the
  invariant is violated at the row level.

`assertExecutionAdmissible` cases:

- verdict `"ok"` + no override → returns
- verdict `"ok"` + override (ignored) → returns; no override audit
  recorded
- verdict `"mismatch"` + no override → throws
  `WorkTraceIntegrityError`
- verdict `"missing_anchor"` + no override → throws
- verdict `"skipped"` + no override → throws
- verdict `"mismatch"` + valid override → returns;
  `work_trace.integrity_override` AuditEntry recorded with
  `actorId`/`reason`
- override missing `actorId` or `reason` → throws (validation)
- override path with no `auditLedger` → throws

### 2. Audit ledger external-tx + findAnchor tests

`packages/core/src/audit/__tests__/ledger-external-tx.test.ts` (new
— uses `InMemoryLedgerStorage`)

- `AuditLedger.record({...}, undefined)` → existing path, opens its
  own tx
- `AuditLedger.record({...}, { tx: mockExternalTx })` → forwards tx
  to `appendAtomic`
- `InMemoryLedgerStorage.appendAtomic(buildEntry, { externalTx })` →
  ignores `externalTx`, behaves identically

`packages/core/src/audit/__tests__/ledger-find-anchor.test.ts` (new
— uses `InMemoryLedgerStorage`)

- `findAnchor` returns the entry whose snapshot.traceVersion
  exactly matches the requested `traceVersion`
- `findAnchor` returns `null` when no entry has the requested
  `traceVersion`
- `findAnchor` ignores entries with the right entityId/eventType
  but a different traceVersion (no nearest-match fallback)
- `findAnchor` correctly disambiguates two entries with the same
  entityId but different `eventType` (`work_trace.persisted` vs
  `work_trace.updated`)
- given 200 sequential updates for one workUnitId, `findAnchor`
  for `traceVersion = 1` still returns the persist anchor (proves
  no arbitrary limit hides old anchors)

`packages/db/src/storage/__tests__/prisma-ledger-storage.test.ts`
(extend existing)

- `appendAtomic(buildEntry)` (no options) → opens own tx, advisory
  lock acquired
- `appendAtomic(buildEntry, { externalTx: tx })` → reuses tx,
  advisory lock acquired on tx
- when caller's outer tx rolls back, the AuditEntry is also rolled
  back (integration test against real Postgres in CI)
- chain integrity preserved: two `appendAtomic` calls in sequence
  (one external-tx, one not) produce a valid chain
- `findAnchor` against Postgres uses JSONB path filter and returns
  the version-exact entry; integration test confirms no full-table
  scan via EXPLAIN snapshot

### 3. Store integration tests (Prisma + real Postgres)

`packages/db/src/stores/__tests__/prisma-work-trace-store-integrity.test.ts`
(new)

Persist:

- `persist(trace)` writes WorkTrace row with `contentHash` +
  `traceVersion = 1`
- same call writes paired `work_trace.persisted` AuditEntry with
  snapshot `{workUnitId, traceId, contentHash, traceVersion: 1,
hashAlgorithm: "sha256", hashVersion: 1}`
- persist where `auditLedger.record` throws → WorkTrace row does NOT
  exist (rollback proved)
- persist where `tx.workTrace.create` throws (non-idempotent) → no
  AuditEntry written
- idempotent retry (P2002 unique-constraint on `idempotencyKey`) →
  no second AuditEntry
- two concurrent persists for different `workUnitId`s → both succeed;
  chain integrity holds

Update:

- `update(workUnitId, fields)` writes new `contentHash`, increments
  `traceVersion`, writes `work_trace.updated` AuditEntry with
  `previousHash`, `previousVersion`, `changedFields`
- update where `auditLedger.record` throws → WorkTrace row reverts
  (rollback proved)
- update with empty `data` (no business fields changed) → no version
  bump, no AuditEntry written
- two sequential updates → traceVersion 1 → 2 → 3, three
  AuditEntries with chained `previousHash`
- terminal-state lock violation → no integrity write, existing
  locked-violation AuditEntry path unchanged (PR #293 regression
  guard)

Read:

- `getByWorkUnitId(id)` for a freshly-persisted row → `{trace,
integrity: {status: "ok"}}`
- direct DB tampering on `executionOutputs` → recompute mismatch →
  `{trace, integrity: {status: "mismatch", ...}}` + alert fired
- direct DB tampering on `contentHash` → recompute mismatch →
  `"mismatch"` + alert fired
- direct DB delete of anchoring AuditEntry → `"missing_anchor"` +
  alert fired
- pre-migration row (`requestedAt < CUTOFF_AT`, `contentHash IS
NULL`) → `"skipped"` + no alert
- post-cutoff row with `contentHash IS NULL` → `"missing_anchor"` +
  alert
- post-cutoff row with `contentHash` present + `traceVersion = 0`
  (forced via direct DB write) → `"missing_anchor"` + alert; never
  `"ok"` even if the recomputed hash happens to match
- changedFields in the `work_trace.updated` AuditEntry contains
  only business fields (e.g. `["outcome", "executionOutputs"]`) —
  never `contentHash`, `traceVersion`, or `lockedAt`
- `auditLedger.findAnchor` throws → returns `{trace, integrity:
"missing_anchor"}` + alert + log; no propagation
- `operatorAlerter.alert` throws inside read → caught + console.error;
  read still returns

`getByIdempotencyKey` mirrors the above with one happy-path + one
mismatch case (full coverage on `getByWorkUnitId`).

### 4. Execution-admission integration tests

`packages/core/src/platform/__tests__/platform-lifecycle-integrity.test.ts`
(new)

For each lifecycle admission site (`:360`, `:558`, `:573`):

- read returns `"ok"` → lifecycle proceeds (existing happy path)
- read returns `"mismatch"` (no override) → throws
  `WorkTraceIntegrityError`; no continuation, no `update()`, no
  external effect
- read returns `"missing_anchor"` (no override) → throws; same
  negative assertions
- read returns `"skipped"` (no override) → throws; same negative
  assertions
- read returns `"mismatch"` + override threaded through → admits +
  records `work_trace.integrity_override` AuditEntry + lifecycle
  proceeds

`packages/core/src/approval/__tests__/lifecycle-service-integrity.test.ts`
(new)

- approval continuation with `"ok"` integrity → existing update path
  runs
- approval continuation with `"mismatch"` → throws
  `WorkTraceIntegrityError`; no update, no notification, no chain
  side-effect
- approval continuation with `"missing_anchor"` → throws; same
  negatives

**Caller-rule enforcement (load-bearing):** for every existing
`update()` call site that drives an external effect, the test asserts
the call site reads first via `getByWorkUnitId` and runs
`assertExecutionAdmissible` on the result before invoking `update`.
Implemented as a structural test in
`packages/core/src/__tests__/work-trace-update-caller-rule.test.ts`
(new) using a spy/mock-fixture that wraps `WorkTraceStore` to track
read-before-update ordering per workUnitId. Asserts:

- `platform-lifecycle.ts:360, :558, :573` — read-before-update
- `approval/lifecycle-service.ts:147` — read-before-update
- a deliberately-broken caller (added in test) that updates without
  reading first → test fails (proves the spy actually catches
  violations)
  This is doctrine + test coverage, not a runtime guard. Future
  `update()` callers must add themselves to the asserted-call-sites
  list.

### 5. Schema and bootstrap tests

`packages/schemas/src/__tests__/schemas.test.ts` (extend existing)

- `AuditEventTypeSchema` parses `"work_trace.persisted"`,
  `"work_trace.updated"`, `"work_trace.integrity_override"`
- existing event types still parse (no regression)

`packages/db/src/stores/__tests__/prisma-work-trace-store-construction.test.ts`
(new)

- constructing `PrismaWorkTraceStore` without `auditLedger` throws
  `Error("PrismaWorkTraceStore requires auditLedger and operatorAlerter")`
- constructing without `operatorAlerter` throws the same error
- constructing with both explicit (real `AuditLedger` + real
  `OperatorAlerter`) → constructs cleanly
- constructing with `auditLedger` + explicit `NoopOperatorAlerter` →
  constructs cleanly (proves the noop is a valid explicit choice)
- store does NOT silently substitute a noop when alerter is omitted
  — assertion that omission throws, never returns a partially-wired
  instance

### 6. Existing-test migration

Any test that asserts on `getByWorkUnitId`'s direct return (today:
`WorkTrace | null`) must be updated to the new shape
(`WorkTraceReadResult | null`). Identified call sites:

- `prisma-work-trace-store.test.ts`
- `prisma-work-trace-store-lock.test.ts`
- `platform-lifecycle.test.ts`
- `lifecycle-service.test.ts`
- `convergence-e2e.test.ts`
- `runtime-first-response.test.ts`
- `work-trace-recorder.test.ts`

These are mechanical updates, not behavioral changes. Spec lists them
so the implementer doesn't miss any during the type-driven sweep.

### Out of scope

- No background-cron full-scan reconciler tests (cron is a follow-up).
- No load tests on advisory-lock contention under integrity load
  (orthogonal to correctness; covered by existing `appendAtomic`
  tests).
- No tampering detection at the AuditLedger level itself — that's
  existing `verifyChain` machinery.
- No UI/dashboard tests for surfacing `integrity.status` — UI
  changes are scoped per consumer in the implementation plan.
- No tests against pre-migration row execution at all admission
  boundaries — `assertExecutionAdmissible` covers it centrally.

## Rollout, doctrine alignment, and follow-up linkage

### Rollout posture

This is a foundational integrity slice, not a feature. Merged
behavior:

- Every newly-persisted WorkTrace carries `contentHash` +
  `traceVersion`.
- Every update produces a paired `work_trace.updated` AuditEntry with
  previous-version chaining.
- Every read returns a verdict; mismatches alert operators but do not
  crash callers.
- Every execution admission point fails closed on `"mismatch"`,
  `"missing_anchor"`, and `"skipped"` (without operator override).
- Pre-migration WorkTrace rows are read-visible but
  execution-inadmissible.
- AuditLedger gains an `externalTx` plumb-through that is null-safe
  for all existing callers.

### Doctrine alignment

This slice satisfies:

- WorkTrace remains canonical persistence; it now carries provable
  integrity at every mutation boundary.
- No mutating bypass: integrity is enforced at the `WorkTraceStore`
  layer, so all four `update()` callers (and any future caller) get
  coverage automatically.
- Approval is still lifecycle state (no behavior change).
- Tools, governance, and ingress are unchanged.
- Operator escalation is honored: integrity overrides must name an
  actor and reason and produce their own audit entry.
- No silent fallbacks: misconfigured stores (no `auditLedger`) fail
  at construction.

This slice intentionally defers:

- Background reconciliation cron.
- Hash-chain crawler that stitches `previousHash` linkage across all
  updates of a single `workUnitId` (the data is there; no UI or
  scanner yet).
- AuditEntry pruning interactions (today AuditLedger is append-only;
  if future TTL/archival policies arrive, anchors must be excluded
  or the read-path query expanded).
- UI affordances for `integrity.status` in the dashboard.

### Follow-up linkage

Add a follow-up entry in `.audit/08-launch-blocker-sequence.md`
immediately after Blocker #19:

```
Follow-up: WorkTrace integrity reconciler + UI surfacing

Goal:
Continuous attestation and operator-visible integrity status.

Required:
- Background cron scanning recent WorkTrace rows, recomputing hashes,
  asserting anchor presence at the row's traceVersion.
- Dashboard widget surfacing per-trace integrity verdict for ops review.
- Audit page badge showing integrity.status alongside trace details.
- Hash-chain visualization across updates of the same workUnitId.

Out of scope here, but unblocked by Blocker #19.
```

### PR title

`Add cryptographic integrity to WorkTrace via anchored content hash`

### Commit message

```
feat(platform): WorkTrace cryptographic integrity via anchored content hash

Every WorkTrace persist and update now produces a paired AuditEntry
that anchors the row's contentHash + traceVersion into the existing
AuditLedger hash chain. Both writes commit on the same Prisma
transaction, so a tampered row, a missing anchor, or a divergent hash
is detectable on read.

Read path is fail-open with a typed integrityVerified verdict and an
operator alert on mismatch. Execution admission boundaries fail closed
on mismatch/missing_anchor/skipped unless an operator override is
threaded through (which itself produces an audit entry).

Forward-only backfill: pre-migration rows are read-visible but
execution-inadmissible.
```

### Merged in this slice

- `contentHash` + `traceVersion` columns on `WorkTrace` (Prisma +
  interface).
- `work_trace.persisted`, `work_trace.updated`,
  `work_trace.integrity_override` audit event types.
- `work-trace-hash.ts` + `work-trace-integrity.ts` pure modules with
  full unit coverage.
- `LedgerStorage.appendAtomic` external-tx parameter.
- `AuditLedger.findAnchor` + `LedgerStorage.findBySnapshotField`
  capability for deterministic version-exact anchor lookup.
- `PrismaWorkTraceStore` rewrites of persist/update/read with paired
  AuditEntry writes inside `prisma.$transaction`.
- New `WorkTraceReadResult` return shape on `getByWorkUnitId` and
  `getByIdempotencyKey`.
- `assertExecutionAdmissible` helper wired at all four admission
  sites in `platform-lifecycle.ts` and `approval/lifecycle-service.ts`.
- Required `auditLedger` AND `operatorAlerter` constructor parameters
  on `PrismaWorkTraceStore` (no silent noop fallback).
- `NoopOperatorAlerter` exported as an explicit opt-in for tests/dev.
- Forward-only backfill cutoff constant + integrity semantics.
- `traceVersion` invariant (`<= 0` with hash present is never `"ok"`).
- Caller rule (read-then-assert before update on execution paths)
  enforced by structural test.
- Operator alert on mismatch/missing_anchor.
- Audit follow-up linkage.

### Left for follow-up

- Background reconciliation cron.
- UI affordances for integrity status.
- Hash-chain visualization across updates.
- AuditEntry archival/pruning policy interactions.
- Risk #20 (ApprovalLifecycle parallel persistence) — orthogonal;
  this slice covers it incidentally because hashing happens at the
  store layer.

---

This PR closes Blocker #19. Operator-visible integrity surfacing and
continuous attestation are tracked as the follow-up entry above.
