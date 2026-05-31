# D1 — Trace-atomicity double-spend window: design

**Status:** approved-for-planning
**Date:** 2026-05-31
**Branch:** `fix/d1-trace-atomicity-double-spend`
**Finding:** `docs/audits/2026-05-26-goal-governance-audit/findings.md` (D1), re-surfaced in the 2026-05-31 governance-invariant triage.
**Invariants:** 2 (WorkTrace is canonical), 5 (idempotency — retries never double-apply).

## 1. Problem (reproduced, not theoretical)

`PlatformIngress.submit()` on the execute path:

1. **Replay guard** (`platform-ingress.ts:94`) — `traceStore.getByIdempotencyKey(org, key)`; if a trace exists, return the cached result **without re-executing**.
2. **Dispatch** (`:297`) — `modeRegistry.dispatch(...)` runs the handler, which commits the **domain write + outbox atomically in the handler's _own_ transaction**. That transaction closes before `dispatch()` returns.
3. **persistTrace** (`:330`) — a **separate** transaction writes the canonical `WorkTrace`.
4. **Retry exhaustion** (`:381-399`) — `persistTrace` retries 3× and, on terminal failure, records an infra-failure audit and **swallows** the error; `submit()` returns `ok:true`.

So a DB blip on the trace write yields a **committed revenue/consent/opportunity mutation with no WorkTrace**. Because the replay guard keys on the trace existing, an idempotent retry finds nothing → **re-executes the handler → double spend**.

**Phase 0 reproduction** (`packages/core/src/platform/__tests__/platform-ingress-trace-atomicity.test.ts`) demonstrates this with minimal mocking: the ingress builds the real `WorkTrace`; the in-memory store round-trips it; the domain write and the trace persist stay genuinely separate (as in production). Result: handler dispatched **twice**, **two revenue rows**, first submit returned `ok:true`, and `getByIdempotencyKey` returned `null` in the window. This test is the red test of the TDD cycle; the fix turns it green.

## 2. Decision: Remedy B — claim-first, fail-closed replay guard

We considered three remedies (full analysis: 4-agent adversarial panel, 2026-05-31).

- **Remedy A — thread a transaction into the handler** (domain write + trace commit in one tx). **Rejected for v1.** Only `revenue.ts` threads `runInTransaction`; `consent / opportunity / recommendation / disqualification` call services that own their own internal transactions with no tx parameter; `skill`/`workflow` modes run LLM/child work and cannot sit inside a single DB transaction (Prisma ~5s tx timeout → pool starvation). Shipping it for 1 of 5 handlers is a "safety illusion." It also reverses a documented direction (`recordOperatorMutation` / `store_recorded_operator_mutation` is the deprecated "legacy bypass" that `OperatorMutationMode` was built to replace), and even the existing in-tx pattern (`ConversationStateStore`) splits an atomic `running` insert from a **separate** finalize update — so A does not escape a finalize window either.
- **Remedy C — handler owns its trace.** Rejected — same tx-availability limits as A, plus it re-blesses the deprecated bypass and requires threading the `GovernanceDecision` into every handler.
- **Remedy B — claim-first, fail-closed (chosen).** Buildable entirely within `core`'s `WorkTraceStore` interface (no layering violation), covers **every mode** uniformly at the ingress chokepoint, and **needs no schema migration**: `WorkOutcome` already includes `running`, and `running → {completed, failed}` is already a legal transition (`work-trace-lock.ts:8-13`).

### Core idea

When an idempotency key is present, **claim the key (persist a `running` WorkTrace) _before_ dispatch**, then **finalize** it (`running → completed/failed`) after. The replay guard fails **closed** on a `running` trace: it refuses to re-execute when it cannot prove the prior attempt did not commit.

This converts "committed mutation with no canonical record" into "committed mutation with a `running` canonical record", and converts the double-spend into a safe, surfaced indeterminate state.

## 3. Architecture

### 3.1 New store primitive: `WorkTraceStore.claim()`

The load-bearing change. Today `persist()` returns `void` and **swallows `P2002`**, so it cannot distinguish "won the claim" from "lost the race". We add a sibling that reports the outcome:

```ts
// work-trace-recorder.ts (interface)
type WorkTraceClaimResult = { claimed: true } | { claimed: false };
interface WorkTraceStore {
  // ...existing persist / getByWorkUnitId / update / getByIdempotencyKey
  claim(trace: WorkTrace): Promise<WorkTraceClaimResult>;
}
```

`PrismaWorkTraceStore.claim(trace)` mirrors `persist()` (insert WorkTrace + `work_trace.persisted` anchor in one `$transaction`) **except**: on `P2002` for the idempotency key it returns `{ claimed: false }` instead of swallowing to `void`; on success returns `{ claimed: true }`; other errors throw (so the retry loop can act). The claim is the same atomic `@@unique([organizationId, idempotencyKey])` insert — which is why it **also** serializes concurrent same-key submits (one wins, others get `claimed:false`). `claim()` is intentionally **mode-agnostic** so D4 can reuse it (see §6).

### 3.2 Claim-trace builder

`buildWorkTrace` with no `executionResult` and an `execute` decision yields `pending_approval` (`work-trace-recorder.ts:57-64`) — wrong for a claim. We add a minimal claim builder (a `buildWorkTrace` variant or `buildClaimTrace`) that produces a `running` trace with `executionStartedAt` **sealed** and no execution fields. `executionStartedAt` is a `ONE_SHOT` field (`work-trace-lock.ts:44-50`): it is set at claim time and **never re-sent** at finalize, or `validateUpdate` rejects the update and the row wedges.

### 3.3 `submit()` execute-path flow (idempotency key present)

```
0. replay guard: getByIdempotencyKey(org, key)
     existing.outcome === "running"            -> FAIL CLOSED (indeterminate)   [NEW]
     existing.outcome in {completed, failed, queued, pending_approval} -> cached return  [unchanged]
     no existing trace                          -> proceed
... governance == execute ...
7a. CLAIM: claim(runningTrace)   (retry transient errors)
       claimed:false  -> FAIL CLOSED (concurrent winner is executing)          [NEW]
       claim insert fails terminally (transient) -> abort BEFORE dispatch, return retryable error
                                                    (nothing committed -> safe)
7b. DISPATCH: modeRegistry.dispatch(...)   (domain write commits)
7c. FINALIZE: update(workUnitId, { outcome, durationMs, executionSummary,
                                   executionOutputs, error, completedAt, ... })  (retry transient)
       update succeeds        -> return the executionResult (ok)
       update fails terminally -> STILL return the executionResult (ok) + recordInfrastructureFailure + alert,
                                  leaving the running claim for reconciliation
                                  (the mutation committed; danger is only on retry, which fails closed)
```

- **Return on finalize-failure:** the domain mutation already committed, so `submit()` returns the successful `executionResult` exactly as today (persistTrace's swallow behavior is preserved). The only difference is the trace is left `running` (not absent) + an alert fires. The double-spend is prevented on the _retry_, not by failing this call.
- **Fail-closed response** (on a `running` replay or a lost claim) is a new `IngressError` (`type: "idempotency_in_flight"`), distinct so callers know: _the prior attempt's outcome is unknown; do not blindly retry; escalate._ This is the human-escalation path (Invariant 3) and reuses the existing infra-failure alert. It is distinct from the **claim-insert transient failure** (§7a), which returns a **retryable** error because nothing committed.
- **Handler-throw path** (`:303` catch): the `running` claim already exists, so the catch **updates** `running → failed` (`EXECUTION_EXCEPTION`) instead of creating. The original handler error still rethrows (preserves the #677 §2.4 invariant). If that update fails, the claim stays `running` → retry fails closed.
- A `running` trace **reached via the org-scoped idempotency-key lookup** is exclusively an ingress claim, so fail-closed on `running` is unambiguous. (The conversation/lifecycle stores persist only _keyless_ `running` rows, which the keyed lookup can never return.) `queued` (legitimate async workflow result) keeps its existing cached-return behavior.
- **Non-terminal finalize (review fix):** a keyed submit's dispatch can resolve to a **non-terminal** outcome — a `workflow`-mode submit (e.g. `creative.job.submit`) returns `queued`, and `pending_approval` is possible. Finalize records the _actual_ dispatch outcome, so `running → {queued, pending_approval}` must be a legal transition or the claim wedges at `running` (spurious `trace_persist_failed` alert + fail-closed on a legitimate replay). `ALLOWED_OUTCOME_TRANSITIONS["running"]` is therefore `{completed, failed, queued, pending_approval}`. The replay guard is unaffected — only `running` fails closed; a finalized `queued`/`pending_approval` falls through to the normal cached return.

### 3.4 Scope: only when `idempotencyKey` is present

Without a key there is no replay path (`:94` requires the key), so no double-spend-via-replay. No-key submits keep the current single-`persist`-after-dispatch behavior. This scopes the extra write (claim + finalize ≈ 2 round-trips) and the test churn to keyed (retryable) requests, where the bug actually lives. The residual Inv2 gap for no-key mutations (missing trace on a `persist` blip, but no double-spend) is pre-existing and out of scope.

### 3.5 Unchanged paths

Deny (`:233`), require-approval (`:240`), and governance-error (`:216`) persist a single terminal/`pending_approval` trace and have no domain mutation — unchanged. Their replay returns remain as today.

## 4. Error handling summary

| Window                                      | Outcome                                | Safety                                                       |
| ------------------------------------------- | -------------------------------------- | ------------------------------------------------------------ |
| Claim insert blips (transient), retried out | Abort before dispatch; retryable error | Safe — nothing committed                                     |
| Concurrent same-key submit                  | `claimed:false` → fail closed          | Safe — only the winner executes                              |
| Handler commits, finalize update blips out  | `running` claim persists; alert        | Safe — retry fails closed; surfaced for reconciliation       |
| Handler throws (rolls back)                 | `running → failed` update; rethrow     | Safe — failed cached on replay (preserves existing contract) |
| Handler throws AND failure-update blips out | `running` claim persists; alert        | Safe (false-positive block until reconciled — see §6)        |

## 5. Testing strategy (TDD)

- **Red → green:** `platform-ingress-trace-atomicity.test.ts` — handler runs **once**; second submit returns `idempotency_in_flight`; ledger has 1 row.
- **New ingress tests:** concurrent claim (one wins, one fails closed); finalize-fails → `running` persists → replay fails closed; handler-throw → `running → failed` → failed cached on replay (parity with `platform-ingress-execution-error.test.ts`); deny/approval/no-key paths unchanged; `executionStartedAt` sealed once.
- **New store test:** `claim()` — `P2002` → `{claimed:false}`; success → `{claimed:true}` (mirror `prisma-work-trace-store.test.ts` mock pattern; CI has no Postgres).
- Full `pnpm test`, `pnpm typecheck`, `pnpm format:check` green before each commit.

## 6. Out of scope — tracked follow-ups

- **Reconciliation sweeper** for orphaned `running` claims (probe the domain/outbox side, resolve to completed/failed). v1 relies on fail-closed + the existing alert → human escalation; the sweeper buys back availability.
- **Domain-level idempotency keys** (thread `idempotencyKey` into domain rows as a unique column) — defense-in-depth so Inv5 holds even if the trace machinery fails.
- **D4** — give the Meta-webhook greeting path a **deterministic child idempotency key** and have it consume `claim()` (the delegate path already mints one at `delegate.ts:74`). The claim primitive is the shared substrate.
- **Revenue-path true atomicity** — optionally fold the trace into `revenue.ts`'s existing tx later (requires an explicit, recorded doctrine decision about the `store_recorded_operator_mutation` bypass).

## 7. Affected files / blast radius

- `packages/core/src/platform/work-trace-recorder.ts` — `claim()` on the interface; claim-trace builder.
- `packages/core/src/platform/platform-ingress.ts` — replay-guard `running` branch; claim→dispatch→finalize; catch-path `running → failed`; reusable retry helper.
- `packages/core/src/platform/ingress-error.ts` — `idempotency_in_flight` error type.
- `packages/db/src/stores/prisma-work-trace-store.ts` — `claim()` impl.
- `apps/api/src/app.ts` — dev/fallback inline `traceStore` stub gains `claim()` (~`:756`).
- Test mocks/literals of `WorkTraceStore` across core/db/api — add `claim`; update execute-path "persist called once" assertions to expect claim + finalize-update.

## 8. Invariant coverage

- **Inv5 (no double-apply):** CLOSED for keyed requests across all modes — `running` → fail closed.
- **Inv2 (canonical record):** a `running` claim is persisted before the mutation, so a committed mutation always carries at least a `running` canonical record (stronger than today). No-key gap pre-existing/out of scope.
- **Inv1 / Inv3 / Inv4 / Inv6:** single ingress preserved; indeterminate surfaces via alert (escalation); claim is org-scoped like `getByIdempotencyKey`; new tests gate regressions in CI.
