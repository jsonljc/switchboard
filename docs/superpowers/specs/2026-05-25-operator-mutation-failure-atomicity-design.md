# Operator-Mutation Failure & Atomicity Contract — Design Spec (#677)

**Status:** Approved (brainstorm + design review), ready for implementation planning.
**Date:** 2026-05-25
**Issue:** [#677](https://github.com/jsonljc/switchboard/issues/677) — Platform: operator-mutation execution-path exceptions skip WorkTrace + non-atomic store/outbox writes.
**Surfaced by:** deep adversarial review of #654-B (revenue route ingress migration, PR #676 / `3730ce0e`). Not a #654-B regression — pre-existing platform behaviors shared by all operator-mutation intents.

**Prior art consumed:**

- `docs/superpowers/specs/2026-05-16-route-governance-contract-v1.md` §4 (envelope), §5 (WorkTrace coverage rule + cohort A/B/C/D canonicalization), §9 (`outputs` sub-pattern).
- `docs/superpowers/specs/2026-05-25-inngest-failure-contract-design.md` §4 (WorkTrace-vs-AuditLedger boundary), §2/§7 (never-throws handler discipline + at-least-once/dedup outbox seam).
- `docs/superpowers/specs/2026-05-15-operator-direct-ingress-pattern.md` (the operator-mutation mode + handler boundary).

---

## Section 0 — Problem

Two coupled, pre-existing defects on the operator-mutation path. Both are platform-level; the revenue handler is merely the first handler that exercises the second one.

### 0.1 Execution-path exceptions persist NO WorkTrace (audit/governance gap)

`PlatformIngress.submit()` (`packages/core/src/platform/platform-ingress.ts`) calls `modeRegistry.dispatch(...)` (≈:292) and then `persistTrace(...)` (≈:300). **The dispatch is not wrapped in try/catch.** Neither `OperatorMutationMode.execute` (`operator-mutation-mode.ts:78`, `await handler.execute(workUnit)`) nor `ExecutionModeRegistry.dispatch` (`execution-mode-registry.ts:29`) catches either.

Consequence: if a handler throws an **infrastructure error** (e.g. `revenueStore.record` or `outboxWriter.write` failing on a DB blip), the exception propagates out of `submit()` before `persistTrace` runs. **No WorkTrace is persisted**, and `recordInfrastructureFailure` (wired only for `governance_eval_exception` and `trace_persist_failed`) does not fire. The route 500s (scrubbed by the global Fastify handler) — but the audit trail has **no record of the attempt**, which is exactly the moment a governed automation system most needs one.

By contrast, every other branch persists: governance-error (:225), deny (:232), require-approval (:247). Only the post-governance **execution** throw is unguarded. This violates the core invariant "WorkTrace is canonical persistence" (DOCTRINE §3) and Route Governance Contract §5 ("any user-initiated operator-direct mutation, including its failure paths, MUST produce a WorkTrace").

This is **orthogonal to** Route Governance §5's cohort canonicalization. §5 covers the case where a handler **returns** `outcome:"failed"` (a domain rejection mapped to a typed 4xx). This spec covers the case where a handler **throws** (an unexpected platform execution fault) — a path §5 never addressed.

### 0.2 Handler record + outbox writes are not atomic (lost-event window)

In governed handlers that both write a domain row and emit an outbox event — today only `buildRecordRevenueHandler` (`apps/api/src/bootstrap/operator-intents/revenue.ts`): `revenueStore.record(...)` then `outboxWriter.write(...)` — the two writes are **separate awaits with no shared transaction**. If `record` succeeds and the outbox `write` throws, you get a **domain row with no conversion event, forever** (and, per 0.1, no WorkTrace). The `OutboxWriter` abstraction currently exposes only `write(...)`, no transaction handle.

The primary failure mode is a **lost event**, not a double event. (At-least-once + downstream dedup addresses double-_delivery_, not this lost-event window — so it does not cure this defect.)

**Verified architectural fact (load-bearing for the chosen fix):** `PrismaOutboxStore.write` (`packages/db/src/stores/prisma-outbox-store.ts`) is **already a relay-based transactional outbox** — `write()` only inserts an `OutboxEvent` row with `status:"pending"`; a separate publisher worker drains it (`fetchPending` → `markPublished`). It does **not** emit synchronously. Therefore wrapping the domain write and the outbox-row insert in one `prisma.$transaction` is coherent, requires **no schema migration** (both tables exist), and the publisher relays the event only after commit.

---

## Section 1 — Scope & coverage statement

- **Part 1 (Section 2)** defines the platform-ingress behavior when a dispatched handler **throws**. It is a single change at the dispatch boundary, so it covers **all operator-mutation intents that reach platform-ingress dispatch after governance admission** — currently opportunity, recommendation, the two disqualification intents, the three consent intents, and revenue.

  Coverage is **path-wide through the dispatch boundary**, not a per-intent obligation. A route that bypasses `PlatformIngress`, or a future intent that executes through a different ingress path, is **not** covered automatically. The contract is platform-wide by design; enforcement is currently realized through this one dispatch boundary.

- **Part 2 (Section 3)** defines the atomicity contract for a handler that performs a **domain write + outbox write**. Today that is **revenue only**; the pattern is written to be reused by any future operator handler that emits an outbox event alongside a domain mutation.

---

## Section 2 — Part 1: execution-path exception → failed WorkTrace (PR-1)

**Migration-free. Touches `packages/core` (ingress) + the observability infra-failure helper only.**

### 2.1 The contract

When `modeRegistry.dispatch(...)` throws (a handler infrastructure exception **after governance admission**), `PlatformIngress.submit()` MUST:

1. Persist a WorkTrace with `outcome:"failed"` carrying the `EXECUTION_EXCEPTION` platform error code.
2. Record an infrastructure failure (`recordInfrastructureFailure`) with `errorType:"execution_exception"`.
3. **Rethrow the original execution exception** — so the global Fastify error handler returns a scrubbed `500` (Route Governance §4.6, "unexpected handler exception").

A thrown handler is **not** a domain rejection. It is a platform execution failure: the route still returns 500, but governance does not lose the trace.

### 2.2 Implementation shape

The try/catch wraps **only the execution dispatch boundary** — after governance has completed and a valid `workUnit`/`decision` exist. It MUST NOT wrap deployment resolution, normalization, governance evaluation, or lifecycle creation (those have their own dedicated error paths at :177, :205, etc.).

```ts
// 7. Execute
const executionStartedAt = new Date().toISOString();
let executionResult: ExecutionResult;
try {
  executionResult = await modeRegistry.dispatch(
    workUnit.resolvedMode,
    workUnit,
    decision.constraints,
    { traceId: workUnit.traceId, governanceDecision: decision },
  );
} catch (executionErr) {
  const completedAt = new Date().toISOString();
  const failed = this.buildFailedResult(workUnit, "EXECUTION_EXCEPTION", "Execution failed");
  // Best-effort audit; persistTrace never rethrows (Section 2.4). Order matters:
  // both calls must run before the rethrow, and neither may replace executionErr.
  await this.persistTrace(
    traceStore,
    workUnit,
    decision,
    governanceCompletedAt,
    failed,
    executionStartedAt,
    completedAt,
  );
  await this.recordInfrastructureFailure({
    errorType: "execution_exception",
    error: executionErr,
    workUnit,
    retryable: false,
  });
  throw executionErr; // original error rethrown → global handler → scrubbed 500
}
const completedAt = new Date().toISOString();
await this.persistTrace(
  traceStore,
  workUnit,
  decision,
  governanceCompletedAt,
  executionResult,
  executionStartedAt,
  completedAt,
);
return { ok: true, result: executionResult, workUnit };
```

### 2.3 `EXECUTION_EXCEPTION` is a platform code, never a domain code

**Invariant:** `EXECUTION_EXCEPTION` is a platform-failure code used **only** for execution-path exceptions **after governance admission** — never for handler-level domain rejection.

It MUST NOT be added to `OPERATOR_INTENT_ERROR_CODES`. Those codes are domain/request/operator-route errors that map to typed `4xx` responses. Keeping `EXECUTION_EXCEPTION` distinct prevents accidental 4xx mapping and keeps the audit semantics unambiguous: a `failed` WorkTrace whose `error.code === "EXECUTION_EXCEPTION"` is a platform fault; a `failed` WorkTrace whose code is an `OPERATOR_INTENT_ERROR_CODES` value is a domain rejection (cohort A).

It is supplied as a literal to the existing `buildFailedResult(workUnit, code, message)` helper — no enum/registry change.

### 2.4 Trace persistence must never mask the original execution exception

**Invariant:** the catch path must never allow trace-persistence failure to replace the original execution exception. `persistTrace` remains best-effort-with-infra-audit and MUST return `void`.

`persistTrace` already satisfies this: its retry loop catches every attempt and, on terminal failure, calls `recordInfrastructureFailure` and returns — it never rethrows. The catch block therefore always reaches `throw executionErr` with the original error intact. Implementation must preserve this property visibly (do not introduce an `await` in the catch that can throw and shadow `executionErr`), and it is locked by a regression test (Section 4.1, test 4).

`recordInfrastructureFailure` is likewise non-throwing (it wraps its audit-ledger write in try/catch and uses `safeAlert`).

### 2.5 Idempotency interaction (verified safe — prevents double-write)

The failed WorkTrace is persisted with `workUnit.idempotencyKey`. A same-key replay therefore hits step-0 `getByIdempotencyKey`, finds the failed trace, and **returns the recorded failure without re-dispatching** — standard exactly-once semantics, and identical to how cohort-A domain failures already behave on replay.

This is correct and deliberate: a genuine retry must use a **new** idempotency key, because the first attempt already produced a terminal `failed` trace for that key. The platform MUST NOT auto-retry same-key thrown executions — doing so risks double-writes and violates the existing cohort-A contract. Net effect: the failed-trace path **strengthens** idempotency safety rather than weakening it.

### 2.6 Type/helper changes

- `recordInfrastructureFailure` `errorType` union: `"governance_eval_exception" | "trace_persist_failed"` → add `"execution_exception"`.
- `buildInfrastructureFailureAuditParams` (`packages/core/src/observability/infrastructure-failure.ts`): add the matching branch (audit `action` label + alert text) for `"execution_exception"`.

---

## Section 3 — Part 2: revenue transactional outbox (PR-2)

**Migration-free. Touches `apps/api` (handler + bootstrap + test-server) + `packages/db` (store signatures) + a `packages/db` type re-export. Core's `RevenueStore` interface gains one opaque, non-Prisma param.**

### 3.1 The atomicity contract

For a handler that performs a domain write **and** an outbox write, **either both commit or neither commits.** The transaction boundary lives in the **app-layer handler** (`buildRecordRevenueHandler`) — not in platform-ingress. Atomicity of a handler's side effects is a handler concern; ingress only governs admission + WorkTrace.

```ts
const event = await runInTransaction(async (tx) => {
  const ev = await revenueStore.record(
    {
      /* … */
    },
    tx,
  );
  await outboxWriter.write(
    `evt_rev_${ev.id}`,
    "purchased",
    {
      /* … */
    },
    tx,
  );
  return ev;
});
```

If either write throws inside the callback, `$transaction` rolls back **both** the `LifecycleRevenueEvent` row and the `OutboxEvent` row. The publisher worker only ever sees the outbox row after commit.

### 3.2 The transaction context is opaque in core, owned by the app-layer runner

To keep `prisma.$transaction` and Prisma types out of Layer 3 (`packages/core` must not import `@switchboard/db`), the transaction context is a **named, opaque** type owned by the abstraction — not by Prisma:

```ts
// packages/core (lifecycle/revenue-store.ts or a small shared module)
export type StoreTransactionContext = unknown;

export interface RevenueStore {
  record(input: RecordRevenueInput, tx?: StoreTransactionContext): Promise<LifecycleRevenueEvent>;
  // … other methods unchanged
}
```

```ts
// packages/db — narrows the opaque context to the concrete Prisma tx client
async record(input: RecordRevenueInput, tx?: PrismaTransactionClient): Promise<LifecycleRevenueEvent> {
  const client = tx ?? this.prisma;
  // … all reads/writes use `client` instead of `this.prisma`
}
```

**Constraint:** core logic MUST NOT inspect, construct, or pass around Prisma-shaped objects. It only **forwards** the context it received from `runInTransaction` into the store calls. The opaque `tx?` param stays narrow — it exists solely to thread this one runner's context; it is not an invitation for arbitrary core stores to accept unknown transaction handles.

- `PrismaTransactionClient` is a `@switchboard/db` re-export of `Prisma.TransactionClient`. `apps/api` (Layer 5) and `packages/db` (Layer 4) may use it; core may not.
- `OutboxWriter` (app-local interface in `revenue.ts`) `write` gains the same optional `tx?` param; `PrismaOutboxStore.write(eventId, type, payload, tx?)` narrows it and uses `tx ?? this.prisma`.

### 3.3 The `runInTransaction` runner is injected at bootstrap

`buildRecordRevenueHandler` receives `runInTransaction` (alongside `revenueStore` + `outboxWriter`):

```ts
runInTransaction<T>(fn: (tx: StoreTransactionContext) => Promise<T>): Promise<T>
```

- **`app.ts`** supplies the real runner closing over the Prisma client:
  `runInTransaction: (fn) => prisma.$transaction((tx) => fn(tx))`.
- **`test-server.ts`** supplies a no-op runner that invokes the callback with a sentinel:
  `runInTransaction: async (fn) => fn(SENTINEL_TX)`. The test mocks for `revenueStore`/`outboxWriter` ignore the `tx` arg, so the sentinel only proves the context is **threaded** (Section 4.2, test 1). True rollback is proven by an integration test (Section 4.2, test 2).

This shape makes the pattern explicit: the app handler receives a transaction context and passes it to the stores; the stores know how to narrow it. The handler keeps `RevenueStore` (core interface) as its `revenueStore` param type — **not** the concrete `PrismaRevenueStore` — preserving the #654-B test-mock seam (`TestRevenueStore.record` throws; tests inject their own typed mock).

### 3.4 Out of scope: the non-deterministic `opportunityId`

The handler's fallback `resolvedOpportunityId = params.opportunityId ?? rev-${contactId}-${Date.now()}` could double-write on a retry that omits a stable idempotency key. This is **already mitigated** and **not** changed by this spec (the user selected the transactional-outbox option, not the belt-and-suspenders variant):

- the route enforces `requireIdempotencyKey` (#654-B), so HTTP replays dedup at ingress step-0;
- `PrismaRevenueStore.record` additionally dedups on `externalReference` when provided.

### 3.5 Composition with Part 1

The two parts compose cleanly. If the `$transaction` rolls back, the handler throws → **Part 1** catches at the dispatch boundary → persists a `failed` WorkTrace that accurately records "no domain row, no outbox row" → rethrows → scrubbed 500. Both-or-neither at the data layer, fully auditable at the governance layer.

---

## Section 4 — Required test coverage

### 4.1 PR-1 (core, ingress)

1. **Throwing handler persists failed trace and rethrows.** A mode/handler that throws ⇒
   - `traceStore.persist` called once;
   - persisted `outcome === "failed"` and `error.code === "EXECUTION_EXCEPTION"`;
   - `recordInfrastructureFailure` called with `errorType:"execution_exception"`;
   - `submit()` rejects with **the original thrown error**;
   - no success trace persisted after the catch.
2. **Same-key replay returns stored failure, does not re-dispatch.** First call throws + persists failed trace; second call with the same `Idempotency-Key` does **not** invoke `modeRegistry.dispatch` and replays the recorded failure per step-0 semantics.
3. **Domain failure unchanged (regression guard).** A handler that _returns_ `outcome:"failed"` still flows through the normal success-path `persistTrace` and is **not** classified as `EXECUTION_EXCEPTION`. (Prevents PR-1 from collapsing domain rejection and thrown infra exception into one behavior.)
4. **Trace-persist failure does not mask the original exception.** When the handler throws **and** trace persistence fails terminally, `submit()` still rejects with the original handler error, not the trace-persistence error. (If `persistTrace`'s no-throw guarantee is fully covered at the `persistTrace` level, this may be asserted there instead — but the invariant is high-value and must be locked somewhere.)

### 4.2 PR-2 (app + db)

1. **Both writes receive the same transaction context.** With `runInTransaction: async (fn) => fn(sentinelTx)`: `revenueStore.record(..., sentinelTx)` called **and** `outboxWriter.write(..., sentinelTx)` called.
2. **Outbox write throws → revenue write rolls back (integration).** A Prisma-backed (or commit-on-success-only fake-runner) test proving that when `outboxWriter.write` throws, no `LifecycleRevenueEvent` row persists. A no-op sentinel runner cannot prove rollback; at minimum a unit test asserts the handler throws and Part 1 produces a failed WorkTrace, but **true atomicity requires the integration test.**
3. **Revenue write throws → no outbox write.** `revenueStore.record` throws ⇒ `outboxWriter.write` **not** called; handler throws; ingress (Part 1) records the failed WorkTrace.
4. **Success path produces both rows.** Revenue event exists; outbox row exists with `eventId === evt_rev_${ev.id}`, `type === "purchased"`, `status === "pending"`.

---

## Section 5 — Sequencing

Two focused PRs off an updated `main`, each reviewed for its own invariant.

- **PR-1 — failed WorkTrace on execution exception (governance-invariant fix).**
  Scope: `platform-ingress.ts` dispatch try/catch + rethrow; `recordInfrastructureFailure` union widening; `buildInfrastructureFailureAuditParams` branch; PR-1 tests (Section 4.1). **No app/db transaction changes.** Lands first — it closes the observability/governance hole independently and touches the core ingress invariant, so it warrants isolated review rigor.

- **PR-2 — revenue transactional outbox (atomicity fix).**
  Scope: `buildRecordRevenueHandler` + injected `runInTransaction`; `app.ts` Prisma `$transaction` runner; `test-server.ts` sentinel runner; `PrismaRevenueStore.record(input, tx?)`; `PrismaOutboxStore.write(..., tx?)`; `@switchboard/db` `PrismaTransactionClient` re-export; core `StoreTransactionContext` opaque type + `RevenueStore.record` param; PR-2 tests (Section 4.2).

Both PRs are migration-free.

---

## Section 6 — Non-goals / deferred

- No generalized cross-handler transaction framework — only the revenue handler emits an outbox write today; the pattern is documented for reuse, not pre-abstracted (YAGNI).
- No change to the non-deterministic `opportunityId` (Section 3.4).
- No `check-routes`-style static enforcement that asserts the dispatch boundary is guarded — Part 1 is a single internal code path, not a per-route surface. (If operator-mutation entry points ever multiply, an enforcement check could be revisited.)
- No new `FailedJobStore`/replay queue — out of scope here as in the Inngest contract; WorkTrace + infra-failure audit provide the visibility.
